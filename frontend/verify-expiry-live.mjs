// 只读页面检查：复用已有合成账号，不建单、不付款、不调用模型。
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const context = await browser.newContext({baseURL:'https://39.96.27.134'});
  const response = await context.request.post('/api/auth/login', {headers:{Origin:'https://39.96.27.134'},data:{username:'sandbox-check-1791700338469',password:'synthetic-test-password'}});
  assert.equal(response.ok(),true,'合成账号登录失败');
  const page = await context.newPage();
  const shop = await (await context.request.get('/api/shop')).json();
  console.log('合成账号订单状态', (shop.orders||[]).map(o=>({status:o.status,query_status:o.query_status,can_pay:o.can_pay})));
  await page.goto('/#/shop');
  console.log('页面脚本',await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('src'))));
  await page.getByText('订单已超时取消，支付宝尚未创建交易').first().waitFor();
  assert.equal(await page.getByRole('button',{name:'前往官方沙箱'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'模拟支付成功'}).count(),0);
  console.log('公网沙箱页面检查通过：旧订单超时取消，付款入口隐藏；未建单、未付款。');
} finally { await browser.close(); }
