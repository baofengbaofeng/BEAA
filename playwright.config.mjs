import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'tests/browser', fullyParallel:true, workers:2, forbidOnly:!!process.env.CI,
 reporter:[['list'],['json',{outputFile:'test-results/browser-results.json'}]],
 use:{baseURL:'http://127.0.0.1:4173',headless:true,trace:'retain-on-failure',
  launchOptions:process.env.BEAA_CHROMIUM_PATH?{executablePath:process.env.BEAA_CHROMIUM_PATH,args:['--no-sandbox']}:{}},
 webServer:{command:'python3 -m http.server 4173 --bind 127.0.0.1',url:'http://127.0.0.1:4173/apps/web-preview/',reuseExistingServer:false,stdout:'ignore',stderr:'ignore'}
});
