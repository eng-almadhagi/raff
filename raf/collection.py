"""Permission-gated, rate-limited collection of inventory URLs only."""
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser
from .source_adapter import parse_dorar_page

AGENT = "Raf-Collection/0.2"
ORIGIN = "https://dorar.net"


def source_url(url):
    parts=urlsplit(url)
    return (parts.scheme=="https" and parts.netloc=="dorar.net" and not parts.query
            and not parts.fragment and re.fullmatch(r"/feqhia/[0-9]+(?:/[^\s]*)?",parts.path) is not None)


class SourceRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if not source_url(newurl):
            raise ValueError("Source redirected outside the allowed encyclopedia")
        if urlsplit(req.full_url).path.split("/")[2] != urlsplit(newurl).path.split("/")[2]:
            raise ValueError("Source redirected to another page")
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def write_json(path,value):
    path=Path(path)
    temporary=path.with_suffix(path.suffix+".part")
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf-8")
    temporary.replace(path)


def read_response(url,opener=None):
    opener=opener or build_opener(SourceRedirect())
    with opener.open(Request(url,headers={"User-Agent":AGENT}),timeout=25) as response:
        body=response.read(3_000_001)
        if len(body)>3_000_000:
            raise ValueError("Source response too large")
        return body.decode("utf-8")


def validate_permission(permission,book_id):
    if (permission.get("source_origin") != ORIGIN or permission.get("book_id") != book_id
        or permission.get("collection_allowed") is not True
        or not isinstance(permission.get("permission_reference"),str)
        or not permission["permission_reference"].strip()
        or not isinstance(permission.get("approved_by"),str) or not permission["approved_by"].strip()):
        raise ValueError("Documented collection permission for this book is required")


def collect(inventory_path,permission,cache_directory,limit=1,interval=3,fetch=read_response,sleep=time.sleep):
    if not 1 <= limit <= 20 or interval < 2:
        raise ValueError("Use 1-20 pages per batch and at least two seconds between requests")
    inventory_path=Path(inventory_path)
    inventory=json.loads(inventory_path.read_text(encoding="utf-8"))
    validate_permission(permission,inventory["book_id"])
    for page in inventory["pages"]:
        if page["book_id"] != inventory["book_id"] or not source_url(page["url"]):
            raise ValueError("Inventory contains an unexpected book or source URL")
        if page["page_id"] != urlsplit(page["url"]).path.split("/")[2]:
            raise ValueError("Inventory page id does not match URL")
    # robots controls automated access, not copyright permission. Require both independently.
    robots=RobotFileParser()
    robots.parse(fetch(ORIGIN+"/robots.txt").splitlines())
    root=Path(cache_directory)
    root.mkdir(parents=True,exist_ok=True)
    processed=0
    for page in inventory["pages"]:
        if page["status"] in {"parsed","reviewed","indexed"}:
            continue
        if processed>=limit:
            break
        if not robots.can_fetch(AGENT,page["url"]):
            page.update(status="access_disallowed",error="robots.txt disallows collection")
            write_json(inventory_path,inventory)
            continue
        cache=root/f"{page['page_id']}.html"
        try:
            if cache.exists():
                html=cache.read_text(encoding="utf-8")
            else:
                sleep(interval)
                for attempt in range(3):
                    try:
                        html=fetch(page["url"])
                        break
                    except HTTPError as exc:
                        if exc.code in {401,403,429} or attempt==2:
                            raise
                        sleep(interval*(attempt+2))
                    except (URLError,TimeoutError):
                        if attempt==2:
                            raise
                        sleep(interval*(attempt+2))
                # Do not cache challenge/error pages as successfully fetched source content.
                if 'id="cntnt"' not in html:
                    raise ValueError("Unrecognized or protected source page; manual inspection required")
                cache.write_text(html,encoding="utf-8")
                page["fetched_at"]=datetime.now(timezone.utc).isoformat()
            page["raw_sha256"]=hashlib.sha256(html.encode()).hexdigest()
            page["status"]="fetched"
            draft=parse_dorar_page(html,page)
            write_json(root/f"{page['page_id']}.draft.json",draft)
            page.update(status="parsed",parsed=True,reviewed=False,footnotes=len(draft["footnotes"]),error=None)
        except HTTPError as exc:
            page.update(status="unreachable",error=f"HTTP {exc.code}")
            if exc.code in {401,403,429}:
                write_json(inventory_path,inventory)
                raise ValueError("Collection stopped on access restriction or rate limit") from exc
        except (URLError,TimeoutError,OSError):
            page.update(status="unreachable",error="Network or filesystem failure")
        except ValueError as exc:
            page.update(status="needs_review",error=str(exc))
        processed+=1
        write_json(inventory_path,inventory)
    return {"processed":processed,"parsed":sum(p["status"]=="parsed" for p in inventory["pages"]),
            "reviewed":sum(p.get("reviewed") is True for p in inventory["pages"]),"total":len(inventory["pages"])}
