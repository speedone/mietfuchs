# python3 -I integrity.py <sqlite>
import sqlite3, sys, json
c = sqlite3.connect(sys.argv[1])
print('integrity_check', c.execute('PRAGMA integrity_check').fetchall())
print('foreign_key_check', c.execute('PRAGMA foreign_key_check').fetchall())
tabs = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
mig = [t for t in tabs if 'migration' in t]
for t in mig:
    cols=[r[1] for r in c.execute(f'PRAGMA table_info({t})')]
    print(t, cols, c.execute(f'select * from {t} order by rowid desc limit 3').fetchall())
if 'cost_sources' in tabs:
    print('cost_sources', c.execute('select * from cost_sources order by id').fetchall())
    for sid, n, s, ps in c.execute("select source_id, count(*), sum(amount_cents), group_concat(period||':'||amount_cents, ' ') from cost_items where source_id is not null group by source_id order by source_id"):
        print('  source', sid, n, s, ps)
    print('orphan sources (no parts)', c.execute('select id from cost_sources where id not in (select source_id from cost_items where source_id is not null)').fetchall())
    print('parts with source in other property', c.execute('select ci.id from cost_items ci join cost_sources s on s.id=ci.source_id where s.property_id<>ci.property_id').fetchall())
    print('fk list cost_items', [r for r in c.execute('PRAGMA foreign_key_list(cost_items)') if r[2]=='cost_sources'])
