const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const htmlFile = 'file://' + 'c:\\Users\\SWS\\Desktop\\GRC\\ComplyZone_Datasheet_Final.html'.replace(/\\/g, '\\\\');
  
  await page.goto(htmlFile, { waitUntil: 'networkidle2' });
  
  await page.pdf({
    path: 'c:\\Users\\SWS\\Desktop\\GRC\\GRCEye_Datasheet_2026.pdf',
    format: 'A4',
    printBackground: true,
    margin: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    }
  });
  
  console.log('PDF generated successfully: GRCEye_Datasheet_2026.pdf');
  await browser.close();
})();
