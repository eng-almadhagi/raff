"""Minimal inert HTML tree for offline source inspection; never executes scripts."""
from html.parser import HTMLParser


class Node:
    def __init__(self, tag="", attrs=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []

    def text(self):
        return "".join(child if isinstance(child,str) else child.text()
                       for child in self.children).strip()

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child,Node):
                yield from child.walk()


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag,attrs)
        self.stack[-1].children.append(node)
        if tag not in {"area","base","br","col","embed","hr","img","input","link","meta",
                       "param","source","track","wbr"}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack)-1,0,-1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)
