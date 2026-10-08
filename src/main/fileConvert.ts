import fs from 'fs';
import { parse } from 'node-html-parser';

const filename = 'test-files/the-climate-old-format.midst';
const newFilename = 'test-files/the-climate-converted.json';

interface ChangeObj {
  front: number;
  inserted: string;
  end: number;
  t: Date;
}

interface OldMidstTimelineFrame {
  content: string;
  lineNumber: string;
  timestamp: number;
}

interface NewFrames {
  content: string;
  t: Date;
}

const compareStrings = (str: string, next: string, t: Date): ChangeObj => {
  let inserted = '';
  let front = 0;
  let end = 0;

  //   if (str === next) return { inserted, front, end, t };
  while (str[front] === next[front] && front < str.length) {
    front += 1;
  }

  // you could definitely do this just by shortening the while loop but okay
  const choppedStr = str.slice(front);
  const choppedNext = next.slice(front);
  while (
    choppedStr[choppedStr.length - end - 1] ===
      choppedNext[choppedNext.length - end - 1] &&
    end < choppedStr.length
  ) {
    end += 1;
  }

  inserted = next.slice(front, next.length - end);
  return { inserted, front, end, t };
};

const oldMidstFile = fs.readFileSync(filename, 'utf8');
const oldMidstJSON = JSON.parse(oldMidstFile);

const frames = oldMidstJSON.editorTimelineFrames;

const newFrames = frames.map((el: OldMidstTimelineFrame) => {
  const root = parse(el.content);

  root.getElementsByTagName('b').forEach((bold) => {
    bold.tagName = 'strong';
  });
  root.getElementsByTagName('i').forEach((italics) => {
    italics.tagName = 'em';
  });
  const lines = root.getElementsByTagName('p');

  return {
    content: `<div><!--block-->${lines
      .map((p) => {
        return p.innerHTML.includes('<br>')
          ? p.innerHTML
          : `${p.innerHTML}<br>`;
      })
      .join('')}</div>`,
    t: new Date(el.timestamp),
  };
});

fs.writeFile(
  'test-files/intermediate-conversion.json',
  JSON.stringify(newFrames),
  () => {
    console.log('success');
  }
);
// const paddedNewFrames = [{ content: '', timestamp: new Date() }, ...newFrames];

const history = newFrames.map((el: NewFrames, ind: number) => {
  if (ind === 0) {
    return compareStrings('', el.content, el.t);
  }
  return compareStrings(newFrames[ind - 1].content, el.content, el.t);
});

const text = newFrames[newFrames.length - 1].content;

const fullContents = JSON.stringify({
  text,
  history,
});

fs.writeFile(newFilename, fullContents, () => {
  console.log('success');
});
