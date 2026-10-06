"""Collect only a permitted book; never publishes or approves source material."""
import argparse
import json
from pathlib import Path
from raf.collection import collect


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory")
    parser.add_argument("permission")
    parser.add_argument("--cache",default="private/raw")
    parser.add_argument("--limit",type=int,default=1)
    parser.add_argument("--interval",type=float,default=3)
    args=parser.parse_args()
    try:
        result=collect(args.inventory,json.loads(Path(args.permission).read_text(encoding="utf-8")),
                       args.cache,args.limit,args.interval)
        print(json.dumps(result,ensure_ascii=False))
    except (ValueError,OSError) as exc:
        parser.exit(1,str(exc)+"\n")
