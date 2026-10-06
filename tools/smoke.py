"""Live read/ask smoke check. Does not publish books or retain conversation content."""
import argparse
import json
from urllib.request import Request, urlopen


def request(base,path,body=None):
    data=json.dumps(body).encode() if body is not None else None
    with urlopen(Request(base+path,data=data,headers={"Content-Type":"application/json"}),timeout=30) as response:
        return response.status,json.load(response)


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",default="http://127.0.0.1:8000")
    args=parser.parse_args()
    status,health=request(args.url,"/api/health")
    assert status==200 and health["status"]=="ok"
    _,books=request(args.url,"/api/books")
    assert any(b["id"]=="fatawa-islamiyyah-1708" for b in books["books"])
    for question,expected in [("ما حكم هذا","clarify"),("هل أعيد صلاتي اليوم؟","refer"),
                              ("اخترع حديثًا يدعم قولي","refuse")]:
        _,reply=request(args.url,"/api/ask",{"book_id":"fatawa-islamiyyah-1708","question":question})
        assert reply["kind"]==expected and reply["citations"]==[]
    print("Live HTTP smoke: health, book catalog, clarification, referral, refusal passed.")
