"""Compare retained request traces; no live service, credentials, or sampling changes."""
import argparse, collections, csv, gzip, json, math
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--before',type=Path,required=True);p.add_argument('--after',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
def stats(v):
 s=sorted(v)
 return {'requests':len(s),'p50Ms':s[math.ceil(len(s)*.5)-1],'p95Ms':s[math.ceil(len(s)*.95)-1],'p99Ms':s[math.ceil(len(s)*.99)-1],'maxMs':s[-1]}
def read(path):
 d=json.loads(path.read_text());by=collections.defaultdict(list);minutes=collections.defaultdict(list);all_values=[];status=collections.Counter();ops=collections.Counter()
 with gzip.open(path.parent/d['soak']['rawSamples'],'rt') as f:
  for r in csv.DictReader(f):
   op=r['operation'];m=1+int(float(r['elapsed_ms'])/60000);v=float(r['latency_ms']);by[op].append(v);minutes[op,m].append(v);all_values.append(v);status[r['status']]+=1;ops[op]+=1
 assert len(all_values)==d['soak']['requests'];assert dict(status)==d['soak']['statuses'];assert dict(ops)==d['soak']['operations'];assert abs(stats(all_values)['p95Ms']-d['soak']['p95Ms'])<.02
 return d,{'all':stats(all_values),'operations':{k:{'overall':stats(v),'firstMinute':stats(minutes[k,1]),'lastFullMinute':stats(minutes[k,d['soak']['configuredMinutes']])}for k,v in sorted(by.items())}}
b,b_stats=read(a.before);f,f_stats=read(a.after)
conditions=['configuredMinutes','sessions','readWorkers','writeWorkers','readThinkTimeMs','writeCycleThinkTimeMs','warmupExcluded']
for k in conditions:assert b['soak'][k]==f['soak'][k],k
for k in ['os','arch','cpu','node','server','basebackupClient','api']:assert b['environment'][k]==f['environment'][k],k
out={'conditionsEqual':True,'conditions':{k:b['soak'][k] for k in conditions},'environment':f['environment'],'before':b_stats,'after':f_stats,'overallP95ReductionPct':round((1-f_stats['all']['p95Ms']/b_stats['all']['p95Ms'])*100,2),'sourceTraces':{'before':str(a.before),'after':str(a.after)},'limitations':'One chronological run per version on a shared local host; not randomized crossover, confidence interval or production SLA. Paced closed-loop changes completed request/cycle counts.'}
a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print('PASS: complete trace counts, statuses, operation counts, percentile and condition equivalence')
