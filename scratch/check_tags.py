
import sys
import re

def check_tags(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Simple regex for tags, ignoring strings and comments is hard but let's try
    # This is a very basic tag checker
    tags = re.findall(r'<(/?)([a-zA-Z0-9]+)([^>]*?)(/?)>', content)
    
    stack = []
    for is_closing, name, attrs, is_self_closing in tags:
        if is_self_closing:
            continue
        if is_closing:
            if not stack:
                print(f"Extra closing tag </{name}>")
                continue
            top = stack.pop()
            if top != name:
                print(f"Mismatched closing tag </{name}> (expected </{top}>)")
                stack.append(top) # Put it back to continue finding more
        else:
            stack.append(name)
            
    if stack:
        print(f"Unclosed tags: {stack}")
    else:
        print("Tags appear balanced (ignoring complex JSX cases)")

if __name__ == "__main__":
    check_tags(sys.argv[1])
