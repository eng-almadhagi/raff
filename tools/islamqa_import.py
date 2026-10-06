"""Resumable importer for the site's public offline packages (not a scraper).

Raw packages are immutable. The site manifest supplies snapshots and deltas.
Only officially published answer records in their own language are selected.
"""
import argparse
import gzip
import hashlib
import json
import time
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT=Path('private/islamqa')
MANIFEST='https://files.zadapps.info/m.islamqa.info/dumps/manifest.json'
BASE='https://files.zadapps.info/m.islamqa.info/'


def save(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    temporary.replace(path)


class PlainText(HTMLParser):
    """Preserve paragraph/list boundaries; no normalization of displayed text."""
    def __init__(self):
        super().__init__(convert_charrefs=True);self.parts=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.skip+=1
        if tag in ('p','div','h1','h2','h3','h4','h5','li','br','tr','blockquote'):
            self.parts.append('\n')
        if tag=='li':self.parts.append('• ')
        if tag in ('td','th'):self.parts.append('\t')
    def handle_endtag(self,tag):
        if tag in ('script','style'):self.skip=max(0,self.skip-1)
        if tag in ('p','div','h1','h2','h3','h4','h5','li','tr','blockquote'):self.parts.append('\n')
    def handle_data(self,data):
        if not self.skip:self.parts.append(data)


def plain(html):
    parser=PlainText();parser.feed(html or '')
    return '\n\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())


def acquire(url, target, sizes=()):
    target=Path(target);target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and (not sizes or target.stat().st_size in sizes):return target
    part=target.with_suffix(target.suffix+'.part');offset=part.stat().st_size if part.exists() else 0
    headers={'User-Agent':'Raff-Research/0.7 (offline-package-import)','Accept-Encoding':'identity'}
    if offset:headers['Range']=f'bytes={offset}-'
    request=Request(url,headers=headers)
    try:
        with urlopen(request,timeout=90) as response:
            append=offset and response.status==206
            if append and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):
                raise ValueError('Unexpected range response')
            with part.open('ab' if append else 'wb') as stream:
                while block:=response.read(1024*1024):stream.write(block)
    except HTTPError as exc:
        save(ROOT/'last-error.json',{'url':url,'status':exc.code,'retry_after':exc.headers.get('Retry-After'),'at':datetime.now(timezone.utc).isoformat()})
        # Never retry through a block or rate limit, and never switch identities.
        raise
    except (URLError, TimeoutError, OSError) as exc:
        save(ROOT/'last-error.json',{'url':url,'error':type(exc).__name__,'at':datetime.now(timezone.utc).isoformat()})
        raise
    if sizes and part.stat().st_size not in sizes:raise ValueError('Package length differs from official manifest')
    part.replace(target);time.sleep(1)
    return target


def records(path):
    with Path(path).open('rb') as f:compressed=f.read(2)==b'\x1f\x8b'
    opener=gzip.open if compressed else open
    with opener(path,'rt',encoding='utf-8') as stream:
        for line in stream:
            if line.strip():yield json.loads(line)


def import_language(manifest,lang,limit=None):
    snapshot=max((r for r in manifest['dumps'] if r['lang']==lang),key=lambda r:r['date'])
    packages=[snapshot]+sorted([r for r in manifest.get('deltas',[]) if r['lang']==lang and r['date']>snapshot['date']],key=lambda r:r['date'])
    current={};deletions=[];types=Counter();duplicates=0;package_report=[]
    for p in packages:
        filename=ROOT/'raw'/p['folder']/'data.ndjson.gz'
        if not filename.resolve().is_relative_to((ROOT/'raw').resolve()) or p['file']['name']!='data.ndjson.gz':
            raise ValueError('Invalid official package path')
        # Reuse the already downloaded English package (PowerShell decoded gzip).
        prior=ROOT/'raw'/f'{lang}-2026-10-04.ndjson.gz'
        if p is snapshot and prior.exists() and prior.stat().st_size in (p['file']['sizeCompressed'],p['file']['sizeUncompressed']):filename=prior
        else:acquire(BASE+p['folder']+'/'+p['file']['name'],filename,(p['file']['sizeCompressed'],p['file']['sizeUncompressed']))
        count=0
        for r in records(filename):
            count+=1;types[r['type']]+=1
            if r['type']!='answer':continue
            d=r.get('data') or {};ref=str(d.get('reference',d.get('id',r.get('reference',r.get('id','')))))
            if not ref.isdigit():raise ValueError('Invalid answer identity')
            if r['op']=='deleted':
                deletions.append({'id':ref,'serial':r['serial']})
                if ref in current:current[ref]['unavailable']=True
                continue
            if d.get('lang')!=lang:raise ValueError('Language mismatch in official package')
            if ref in current and r['op']=='created':duplicates+=1
            current[ref]=dict(d,serial=r['serial'])
        expected=sum(p['file'].get(k,0) for k in ('created','updated','deleted'))
        if count != expected:
            raise ValueError(f'Incomplete package: expected {expected}, received {count}')
        package_report.append({'url':BASE+p['folder']+'/'+p['file']['name'],'records':count,'manifest_records':expected,'sha256':hashlib.sha256(filename.read_bytes()).hexdigest()})
    cleaned=ROOT/'clean'/lang;cleaned.mkdir(parents=True,exist_ok=True)
    incomplete=0;dates=[];categories=set();written=0
    for ref,d in current.items():
        if limit is not None and written>=limit:break
        question=plain(d.get('question'));answer=plain(d.get('body'));summary=plain(d.get('description'))
        uid=f'islamqa-{lang}-{ref}'
        unit={'id':uid,'book_id':f'islamqa-{lang}','source':'islamqa','language':lang,'reference':int(ref),
              'url':f'https://islamqa.info/{lang}/answers/{ref}','title':d['title'],'question':question,'answer':answer,
              'site_summary':summary,'text':question+'\n\n'+answer,'published_at':d.get('showDate'),'created_at':d.get('createdAt'),'updated_at':d.get('updatedAt'),
              'topics':d.get('topics',[]),'source_reference':d.get('source'),'official_languages':d.get('contentLangs',[]),
              'fetched_at':datetime.now(timezone.utc).isoformat(),'serial':d['serial'],'unavailable':d.get('unavailable',False),
              'retrievable':bool(question and answer and not d.get('unavailable')),'content_type':'qa',
              'footnotes':[],'source_refs':[],'path':[('الإسلام سؤال وجواب' if lang=='ar' else 'Islam Question & Answer')]+[t['title'] for t in d.get('topics',[])],
              'mufti':(d.get('source') or {}).get('title')}
        unit['sha256']=hashlib.sha256(json.dumps(unit['text'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        raw_hash=hashlib.sha256(json.dumps(d,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        unit['raw_sha256']=raw_hash
        raw_path=ROOT/'records'/lang/ref/(raw_hash+'.json')
        if not raw_path.exists():save(raw_path,d)
        target=cleaned/(ref+'.json')
        if target.exists():
            previous=json.loads(target.read_text(encoding='utf-8'))
            if previous.get('raw_sha256')==raw_hash:unit['fetched_at']=previous['fetched_at']
            else:save(ROOT/'history'/lang/ref/(previous['raw_sha256']+'.json'),previous)
        if not target.exists() or json.loads(target.read_text(encoding='utf-8'))!=unit:
            save(target,unit)
        written+=1
        incomplete+=not unit['retrievable'];dates.extend([d['showDate']] if d.get('showDate') else [])
        categories.update(t['reference'] for t in d.get('topics',[]))
        if written%500==0:save(ROOT/f'progress-{lang}.json',{'cleaned':written,'available':len(current),'at':datetime.now(timezone.utc).isoformat()})
    missing_previous=0
    if limit is None:
        for target in cleaned.glob('*.json'):
            if target.stem in current:continue
            previous=json.loads(target.read_text(encoding='utf-8'))
            if not previous.get('unavailable'):
                save(ROOT/'history'/lang/target.stem/(previous['raw_sha256']+'.json'),previous)
                previous.update(unavailable=True,retrievable=False,availability_reason='absent_from_latest_official_snapshot')
                save(target,previous)
            missing_previous+=1
    credible_dates=[date for date in dates if date[:4].isdigit() and 1997<=int(date[:4])<=datetime.now(timezone.utc).year]
    report={'language':lang,'snapshot_date':snapshot['date'],'last_delta_date':packages[-1]['date'],'packages':package_report,
            'official_records':len(current),'cleaned':written,'incomplete':incomplete,'duplicate_creates':duplicates,'deletions':deletions,
            'oldest_publication':min(dates) if dates else None,'latest_publication':max(dates) if dates else None,'categories':len(categories),'types':dict(types),
            'oldest_credible_publication':min(credible_dates) if credible_dates else None,'placeholder_or_implausible_dates':len(dates)-len(credible_dates),'missing_previous_records':missing_previous,
            'coverage_scope':'official offline answers snapshot plus listed deltas; not proof of whole live website coverage'}
    save(ROOT/f'report-{lang}.json',report);print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--lang',choices=['ar','en'],required=True);parser.add_argument('--limit',type=int);parser.add_argument('--refresh',action='store_true');a=parser.parse_args()
    if a.refresh:
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
        path=acquire(MANIFEST,ROOT/'raw'/f'manifest-{stamp}.json')
    else:path=ROOT/'raw/manifest.json'
    import_language(json.loads(path.read_text(encoding='utf-8')),a.lang,a.limit)
