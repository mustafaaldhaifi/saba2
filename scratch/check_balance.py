
import sys

def find_imbalance(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    stack = []
    line = 1
    col = 1
    
    for i, char in enumerate(content):
        if char == '\n':
            line += 1
            col = 1
        else:
            col += 1
            
        if char == '{':
            stack.append(('{', line, col))
        elif char == '}':
            if not stack:
                print(f"Extra }} at line {line}, col {col}")
                return
            top, l, c = stack.pop()
            if top != '{':
                print(f"Mismatched {char} at line {line}, col {col} (expected {top} from line {l}, col {c})")
                return
        elif char == '(':
            stack.append(('(', line, col))
        elif char == ')':
            if not stack:
                print(f"Extra ) at line {line}, col {col}")
                return
            top, l, c = stack.pop()
            if top != '(':
                print(f"Mismatched {char} at line {line}, col {col} (expected {top} from line {l}, col {c})")
                return
    
    if stack:
        print(f"Unclosed {stack[-1][0]} from line {stack[-1][1]}, col {stack[-1][2]}")
    else:
        print("Balanced")

if __name__ == "__main__":
    find_imbalance(sys.argv[1])
