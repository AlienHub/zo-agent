// Read the native Pi journal through sandbox Exec. No model reasoning is inferred.
export const PI_JOURNAL = String.raw`# Read Pi's own journal through sandbox Exec. No model reasoning is inferred.
import json, os, pathlib
root = pathlib.Path(os.environ.get('STATE_ROOT', '/data/state'))
folder = root / 'agents/providers/pi/sessions'
files = sorted(folder.glob('**/*.jsonl'), key=lambda p:p.stat().st_mtime, reverse=True)
thread = ''
try:
    thread = json.loads((root / 'agents/providers/pi.json').read_text()).get('threadId','')
except (OSError, ValueError):
    pass
selected = next((p for p in files if thread and thread in p.name), files[0] if files else None)
if not selected:
    print(json.dumps({'turns':[]})); raise SystemExit
if selected.stat().st_size > 24*1024*1024:
    raise ValueError('Pi journal exceeds 24 MiB')
turns=[]; turn=None
with selected.open() as journal:
    for line in journal:
        try: record=json.loads(line)
        except ValueError: continue # a writer may still be appending this line
        if record.get('type')!='message': continue
        message=record.get('message',{});role=message.get('role');content=message.get('content',[])
        if isinstance(content,str): content=[{'type':'text','text':content}]
        if role=='user':
            turn={'id':record.get('id'),'timestamp':message.get('timestamp',0),'prompt':'\n'.join(b.get('text','') for b in content if b.get('type')=='text'),'events':[]}
            turns.append(turn)
        elif turn and role in ('assistant','toolResult'):
            def emit(kind, **data):
                turn['events'].append({'seq':len(turn['events'])+1,'kind':kind,'data':data})
            def bounded(value):
                text=value if isinstance(value,str) else json.dumps(value,ensure_ascii=False)
                return text if len(text)<=100000 else text[:100000]+'\n…内容过长，已截断'
            if role=='toolResult':
                output='\n'.join(b.get('text','') if b.get('type')=='text' else '[非文本工具内容]' for b in content)
                emit('tool-end',ToolID=message.get('toolCallId',''),ToolOutput=bounded(output),ToolError=bool(message.get('isError')))
            else:
                for block in content:
                    kind=block.get('type')
                    if kind=='text': emit('text',Text=bounded(block.get('text','')))
                    elif kind=='thinking' and block.get('thinking'): emit('thinking',Text=bounded(block['thinking']))
                    elif kind=='toolCall': emit('tool-start',ToolID=block.get('id',''),ToolName=block.get('name','工具'),ToolInput=block.get('arguments',{}))
        if len(turns)>2000: raise ValueError('too many Pi turns')
print(json.dumps({'turns':turns},ensure_ascii=False))
`;
