#!/usr/bin/env python3
"""issue #3｜開發費項目下拉選單在各寬度下是否完整顯示選取的文字。

依負責人留言 6034461365 的驗收情境：新增「加工程式撰寫與修改／工時計價（小時 × 費率）」與
「委外測試、檢測及第三方機構驗證／固定金額」兩個項目，逐一檢查：
  - 選單寬度 ≥ 選取文字所需寬度（同字型、同內距、含箭頭；不足即被截斷）
  - 「刪除」按鈕在畫面內且點得到（中心點不被其他元素蓋住）
  - 頁面沒有水平捲軸
  - 版面：1440px 維持「分類｜計算方式｜刪除」同一列；390px 兩個選單各占一整行
印出 PASS/FAIL 表，全部通過時結束碼為 0。

用法：python3 tools/check_dev_item_selects.py [--widths 390,1440]
需要 Node 與 Playwright（同 tests/browser-smoke.cjs）：可用 PLAYWRIGHT_NODE_MODULES 指定
playwright 所在的 node_modules，QUOTATION_CHROMIUM_PATH 指定 Chromium。
"""
import argparse, functools, http.server, json, os, subprocess, sys, tempfile, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS = [('program', 'hours'), ('outsourceTest', 'fixed')]

NODE = r"""
const {chromium}=require('playwright');
const [url,widths,items]=JSON.parse(process.argv[2]);
(async()=>{
 const exe=process.env.QUOTATION_CHROMIUM_PATH;
 const browser=await chromium.launch({headless:true,...(exe?{executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
 const rows=[];
 for(const width of widths){
  const page=await (await browser.newContext({viewport:{width,height:900}})).newPage();
  await page.goto(url);
  for(const [category,method] of items){
   await page.locator('#dev-add').click();
   const item=page.locator('.dev-item').last();
   await item.locator('select[aria-label="開發費分類"]').selectOption(category);
   await item.locator('select[aria-label="計算方式"]').selectOption(method);
  }
  rows.push(...await page.evaluate(width=>{
   const out=[];const r=e=>e.getBoundingClientRect();
   const need=sel=>{const c=sel.cloneNode(false);c.append(sel.selectedOptions[0].cloneNode(true));
    c.style.cssText='width:auto;min-width:0;max-width:none;flex:none;position:absolute;visibility:hidden';
    sel.parentNode.append(c);const w=r(c).width;c.remove();return w;};
   document.querySelectorAll('.dev-item').forEach((item,i)=>{
    const [cat,met]=item.querySelectorAll('.dev-item-head select');const del=item.querySelector('.dev-item-head .danger-button');
    for(const sel of [cat,met]){const box=r(sel),w=need(sel),inside=box.left>=r(item).left-0.5&&box.right<=Math.min(r(item).right,innerWidth)+0.5;
     out.push({width,item:i+1,check:sel.getAttribute('aria-label')+'「'+sel.selectedOptions[0].textContent+'」',
      ok:box.width+0.5>=w&&inside,detail:`選單 ${box.width.toFixed(0)}px／文字需要 ${w.toFixed(0)}px`+(inside?'':'，超出卡片')});}
    del.scrollIntoView({block:'center'});const b=r(del);const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
    out.push({width,item:i+1,check:'「刪除」點得到',ok:b.width>0&&b.right<=innerWidth&&b.left>=0&&hit===del,detail:`${b.width.toFixed(0)}×${b.height.toFixed(0)}px`});
    const [c,m,d]=[cat,met,del].map(r);
    if(width>=1440)out.push({width,item:i+1,check:'電腦版：分類｜計算方式｜刪除同一列',ok:Math.abs(c.top-m.top)<2&&Math.abs(c.top-d.top)<12&&Math.abs(c.width-m.width)<1,detail:`列頂 ${c.top.toFixed(0)}/${m.top.toFixed(0)}/${d.top.toFixed(0)}`});
    if(width<=600){const full=r(item.querySelector('.dev-item-head')).width;
     out.push({width,item:i+1,check:'手機：兩個選單各占一整行',ok:m.top>=c.bottom&&c.width>=full-1&&m.width>=full-1,detail:`寬 ${c.width.toFixed(0)}/${m.width.toFixed(0)}／列寬 ${full.toFixed(0)}px`});}
   });
   const sw=document.documentElement.scrollWidth;
   out.push({width,item:'-',check:'沒有水平捲軸',ok:sw<=innerWidth,detail:`scrollWidth ${sw}／視窗 ${innerWidth}`});
   return out;
  },width));
 }
 await browser.close();console.log(JSON.stringify(rows));
})().catch(e=>{console.error(e);process.exit(2);});
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--widths', default='390,1440', help='逗號分隔的視窗寬度（px）')
    widths = [int(w) for w in ap.parse_args().widths.split(',')]

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = dict(os.environ)
    mods = env.get('PLAYWRIGHT_NODE_MODULES') or env.get('CODEX_PRIMARY_RUNTIME_NODE_MODULES')
    if mods:
        env['NODE_PATH'] = os.pathsep.join(p for p in (mods, env.get('NODE_PATH')) if p)
    with tempfile.NamedTemporaryFile('w', suffix='.cjs', delete=False) as f:
        f.write(NODE)
    try:
        arg = json.dumps([f'http://127.0.0.1:{server.server_port}/', widths, ITEMS])
        run = subprocess.run(['node', f.name, arg], capture_output=True, text=True, env=env, timeout=180)
    finally:
        os.unlink(f.name)
        server.shutdown()
    if run.returncode:
        sys.exit(f'瀏覽器檢查無法執行：\n{run.stderr.strip()}')
    rows = json.loads(run.stdout)
    for row in rows:
        print(f"{'PASS' if row['ok'] else 'FAIL'}  {row['width']:>5}px  項目 {row['item']}  {row['check']}  — {row['detail']}")
    failed = sum(not row['ok'] for row in rows)
    print(f'\n{len(rows) - failed}/{len(rows)} PASS' + (f'，{failed} FAIL' if failed else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
