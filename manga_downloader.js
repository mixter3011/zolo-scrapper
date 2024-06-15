const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument, rgb } = require('pdf-lib');
const readline = require('readline');
const { JSDOM } = require('jsdom');

const DIR = process.cwd();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function pageLinks(url) {
  try {
    const { data } = await axios.get(url);
    const dom = new JSDOM(data);
    const document = dom.window.document;
    const imgs = document.querySelectorAll('.container-chapter-reader img');
    const pageUrls = Array.from(imgs).map(img => img.src);
    return pageUrls;
  } catch (error) {
    console.error(`Error fetching page links: ${error}`);
    throw error;
  }
}

async function downloadImage(name, url) {
  try {
    const { data, headers } = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const contentType = headers['content-type'];
    if (!contentType.startsWith('image')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    const imageBuffer = Buffer.from(data, 'binary');
    const image = await sharp(imageBuffer).jpeg().toBuffer();
    fs.writeFileSync(name, image);
  } catch (error) {
    console.error(`Error downloading image ${name} from ${url}: ${error}`);
    throw error;
  }
}

async function downloadAllImages(urls) {
  await Promise.all(urls.map((url, i) => downloadImage(`${i + 1}.jpg`, url)));
}

async function convertToPdf(name, imgs, folderPath) {
  const pdfDoc = await PDFDocument.create();

  for (const imgPath of imgs) {
    if (fs.existsSync(imgPath)) {
      const imgBuffer = fs.readFileSync(imgPath);
      const image = await pdfDoc.embedJpg(imgBuffer);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height
      });
    } else {
      console.warn(`File not found: ${imgPath}, skipping.`);
    }
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(path.join(DIR, `${name}.pdf`), pdfBytes);
  fs.rmdirSync(folderPath, { recursive: true });
  console.log(`Downloaded ${name} successfully`);
}

async function downloadManga(name, url) {
  name = name.replace(/[^a-z0-9\s]/gi, '');
  console.log(`Downloading ${name} from ${url}`);
  const pages = await pageLinks(url);
  console.log(`Downloading ${pages.length} pages`);

  const folderPath = path.join(DIR, name);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath);
  }
  process.chdir(folderPath);

  await downloadAllImages(pages);
  const imgs = pages.map((_, i) => `${i + 1}.jpg`);
  await convertToPdf(name, imgs, folderPath);
}

async function chapterLinks(URL) {
  try {
    const { data } = await axios.get(URL);
    const $ = cheerio.load(data);
    const chapters = $('.chapter-name.text-nowrap').toArray();
    const links = {};
    chapters.forEach(chapter => {
      const chapterName = $(chapter).text().trim();
      const chapterUrl = $(chapter).attr('href');
      links[chapterName] = chapterUrl;
    });
    return links;
  } catch (error) {
    console.error(`Error fetching chapter links: ${error}`);
    throw error;
  }
}

function sortChapters(chapters) {
  const extractChapterNumber = chapterName => {
    const match = chapterName.match(/Chapter (\d+(\.\d+)?)/);
    return match ? parseFloat(match[1]) : Infinity;
  };

  const sortedChapters = Object.keys(chapters)
    .sort((a, b) => extractChapterNumber(a) - extractChapterNumber(b))
    .reduce((acc, key) => {
      acc[key] = chapters[key];
      return acc;
    }, {});

  return sortedChapters;
}

async function main() {
  rl.question('Enter the URL of the manga: ', async URL => {
    console.log(`URL: ${URL}`);
    const chapters = await chapterLinks(URL);
    const filteredChapters = Object.keys(chapters)
      .filter(key => key.includes('Chapter'))
      .reduce((acc, key) => {
        acc[key] = chapters[key];
        return acc;
      }, {});

    const sortedChapters = sortChapters(filteredChapters);

    const options = `
      Choose an option:
      1. Download all chapters at once
      2. Download chapters sequentially
      3. Download a particular chapter
      4. Quit (q)
    `;

    rl.question(options, async choice => {
      if (choice === '1') {
        for (const chapter in sortedChapters) {
          await downloadManga(chapter, sortedChapters[chapter]);
        }
      } else if (choice === '2') {
        for (const chapter in sortedChapters) {
          console.log(`${chapter}: ${sortedChapters[chapter]}`);
          rl.question('Download? (Y/n/q): ', async y => {
            if (y.toLowerCase() === 'y') {
              await downloadManga(chapter, sortedChapters[chapter]);
            } else if (y.toLowerCase() === 'q') {
              console.log('Exiting...');
              process.exit(0);
            }
          });
        }
      } else if (choice === '3') {
        console.log('Available chapters:');
        for (const chapter in sortedChapters) {
          console.log(`${chapter}: ${sortedChapters[chapter]}`);
        }
        rl.question('Enter the name of the chapter to download: ', async chapName => {
          if (sortedChapters[chapName]) {
            await downloadManga(chapName, sortedChapters[chapName]);
          } else {
            console.log('Chapter not found.');
          }
        });
      } else if (choice.toLowerCase() === '4' || choice.toLowerCase() === 'q') {
        console.log('Exiting...');
        process.exit(0);
      } else {
        console.log('Invalid choice, please try again.');
      }
    });
  });
}

main();
