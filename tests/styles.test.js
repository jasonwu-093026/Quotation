// issue #3｜負責人留言 6034461365：開發費項目的「分類」「計算方式」選單不可截斷選項文字。
// 版面行為由 tests/browser-smoke.cjs 與 tools/check_dev_item_selects.py 在真實瀏覽器量測；
// 這裡鎖住造成該行為的樣式規則，讓 npm test 也能抓到回退。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');

// 取出最外層（media 為 null）或指定 @media 區塊中某個選擇器的宣告。
function rule(selector,media=null){
  let scope=css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,'');
  if(media){
    const start=css.indexOf(media+'{');assert.ok(start>=0,media);
    let depth=0,i=start+media.length;
    for(;i<css.length;i++){if(css[i]==='{')depth++;else if(css[i]==='}'&&--depth===0)break;}
    scope=css.slice(start+media.length+1,i);
  }
  const m=scope.match(new RegExp('(?:^|\\})\\s*'+selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\{([^}]*)\\}'));
  return m?m[1].split(';').filter(Boolean):[];
}

test('任何寬度：開發費選單不縮到比最長選項窄，放不下時換行而不截斷文字',()=>{
  assert.ok(rule('.dev-item-head').includes('flex-wrap:wrap'));
  const select=rule('.dev-item-head select');
  assert.ok(select.includes('flex:1'));
  assert.ok(select.includes('min-width:max-content'));
});

test('手機窄螢幕（≤600px）：「分類」「計算方式」選單各占一整行、上下排列，「刪除」靠右另起一行',()=>{
  const select=rule('.dev-item-head select','@media(max-width:600px)');
  assert.ok(select.includes('flex-basis:100%'));
  assert.ok(select.includes('min-width:0'));
  assert.ok(rule('.dev-item-head .danger-button','@media(max-width:600px)').includes('margin-left:auto'));
});
