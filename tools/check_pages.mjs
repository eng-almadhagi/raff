// Full-corpus integrity of the browser artifact, not religious certification.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {preview,evidence,prepare,rank,select,related} from '../site/core.mjs';
const root=process.argv[2]||'private/pages-preview/raf';
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const [meta]=read('catalog.json'), base=`data/${meta.id}/`,units=read(base+'units.json');
for(const [name,hash] of Object.entries(meta.hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,base,name))).digest('hex'),hash);
assert.equal(units.length,3037);assert.equal(new Set(units.map(u=>u.id)).size,units.length);
let complete=0,incomplete=0,spans=0;
for(const u of units){
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(u.text)).digest('hex'),u.sha256);
  const p=preview(u);assert.ok(u.text.includes(p.text));p.complete?complete++:incomplete++;
  for(const e of evidence(u)){assert.equal(u.text.slice(e.start,e.end),e.text);spans++;}
}
const f32=name=>{const b=fs.readFileSync(path.join(root,base,name));return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};
const vocabulary=read('vocabulary.json'),book={units,vocabulary,lexical:prepare(units,vocabulary),focus:f32('focus.f32'),chunks:f32('chunks.f32'),chunkUnits:read(base+'chunk-units.json'),dimension:meta.dimension};
assert.equal(book.focus.length,units.length*meta.dimension);assert.equal(book.chunks.length,book.chunkUnits.length*meta.dimension);
const duplicate=new Map();for(const u of units){const key=crypto.createHash('sha256').update(u.text.trim()).digest('hex');duplicate.set(key,(duplicate.get(key)||0)+1);}
const report={units:units.length,sourceRecords:new Set(units.flatMap(u=>u.source_refs.map(r=>r.page_id))).size,retrievable:units.filter(u=>u.retrievable!==false).length,completeShortAnswers:complete,incompletePreviews:incomplete,evidenceSpans:spans,exactRepeatedUnits:[...duplicate.values()].filter(n=>n>1).length};
if(fs.existsSync('private/pages-query-vectors.json')){
  const cases=JSON.parse(fs.readFileSync('private/pages-query-vectors.json','utf8'));
  report.parity=cases.map(c=>{const rows=rank(book,c.question,c.vector),result=select(units,rows,c.question);return {question:c.question,top:rows.slice(0,5).map(r=>units[r.index].id),kind:result.kind,ids:result.ids.map(i=>units[i].id),pythonTop:c.top,rankingMatches:JSON.stringify(rows.slice(0,5).map(r=>units[r.index].id))===JSON.stringify(c.top)};});
  assert.ok(report.parity.every(c=>c.rankingMatches),'Browser ranking differs from Python reference');
}
fs.writeFileSync('private/pages-integrity-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
