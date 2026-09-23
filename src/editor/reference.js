/* The scripting command reference, shown in a sheet. Content carried over from
   the web version's cheat sheet, reorganised and extended with the additions
   this version makes (marked "new"). */

const SECTIONS = [
  {
    title: 'Keywords',
    rows: [['this', 'the button whose script is running']],
    code: `-- these all refer to the button itself:
hide button this
show button this
move this right by 40 in 1 seconds
if this is visible`,
  },
  {
    title: 'Navigation',
    rows: [
      ['go next', 'next card'],
      ['go prev', 'previous card'],
      ['go first', 'first card'],
      ['go last', 'last card'],
      ['go card &lt;name&gt;', 'card by name'],
      ['go card &lt;n&gt;', 'card by number'],
    ],
    code: `go card card_b
go card 3`,
    note: 'Navigating ends the current script — the destination card runs its own.',
  },
  {
    title: 'Sound',
    rows: [
      ['play sound &lt;name&gt;', 'play a sound'],
      ['wait until done', 'pause until sounds finish'],
      ['wait &lt;n&gt; seconds', 'pause for n seconds'],
    ],
    code: `-- built in, always available:
play sound click
play sound beep
play sound chime
play sound whoosh
play sound drum
play sound glass

-- bundled samples:
play sound explosion
play sound chicken
play sound door_creak

-- play, then continue when it ends:
play sound explosion
wait until done
go next`,
  },
  {
    title: 'Speech',
    isNew: true,
    rows: [
      ['speak &lt;text&gt;', "speaks text aloud using the system's voice"],
      ['speaker &lt;name&gt;', 'sets the voice for speak that follows'],
      ['speaker &lt;n&gt;', 'sets the speaking rate, in words per minute'],
      ['speaker &lt;name&gt; &lt;n&gt;', 'sets both together'],
    ],
    code: `speak "Nice to meet you!"

-- quotes are optional — everything to the end of the
-- line is spoken exactly as written, punctuation included:
speak Well, that was close!

-- change voice, rate, or both — stays in effect until changed again:
speaker Zarvox
speak "Booyah!"

speaker 300
speak "Talking fast now"

speaker Alex 300
speak "Fast, and a different voice"`,
    note: 'Unlike say/ask/yesno, the text after speak is not an expression — ' +
      'variables and & are not evaluated inside it, just spoken literally. ' +
      'Voice names are case-insensitive and match any voice installed on the ' +
      "system (the same ones the Terminal 'say' command sees), multi-word " +
      'names included, e.g. "Bad News".',
  },
  {
    title: 'Buttons',
    rows: [
      ['show button &lt;id&gt;', 'make visible'],
      ['hide button &lt;id&gt;', 'make hidden'],
      ['move &lt;id&gt; &lt;dir&gt; by &lt;n&gt; in &lt;secs&gt;', 'slide a button'],
      ['', 'dir: left right up down'],
      ['', 'n: pixels, or a % of the button size'],
    ],
    code: `show button myRedBtn
hide button this

-- slide right 40px over 2 seconds:
move this right by 40 in 2 seconds

-- slide left by half its own width:
move this left by 50% in 1 seconds`,
  },
  {
    title: 'Effects',
    rows: [['trigger effect &lt;name&gt;', 'shake · flash · wobble · negative']],
    code: `trigger effect shake
trigger effect negative`,
  },
  {
    title: 'Dialogs',
    rows: [
      ['say "text"', 'show a message'],
      ['ask "prompt"', 'text input, result in answer'],
      ['yesno "question"', 'Yes = 1, No = 0, result in answer'],
    ],
    code: `ask "What is your name?"
name = answer

yesno "Play again?"
if answer == 1
  go card start
end`,
  },
  {
    title: 'Variables',
    rows: [
      ['name = value', 'assign'],
      ['+ - * /', 'arithmetic'],
      ['&amp;', 'join text'],
      ['&gt; &lt; &gt;= &lt;= == !=', 'compare'],
    ],
    code: `score = 0
score = score + 10
name = "Alice"
greeting = "Hello " & name
label = "Score: " & score`,
    note: 'Define starting values in the Variables panel. Comparing a number with text reports an error rather than silently failing.',
  },
  {
    title: 'Text objects',
    rows: [['text_1 = …', 'set the content of a text object on the card']],
    code: `text_1 = "New content"
text_2 = score
text_1 = "Score: " & score

-- read it back:
msg = text_1`,
    note: 'Text objects show their script name on a badge in the editor.',
  },
  {
    title: 'Conditionals',
    rows: [
      ['if … end', 'run a block when a condition holds'],
      ['else', 'otherwise'],
      ['else if', 'chain conditions', true],
      ['&lt;id&gt; is [not] visible', 'button visibility'],
      ['card is [not] &lt;name&gt;', 'which card is showing'],
    ],
    code: `if score > 100
  go card gold
else if score > 50
  go card silver
else
  go card bronze
end

if this is visible
  hide button this
end`,
  },
  {
    title: 'Loops',
    isNew: true,
    rows: [
      ['repeat &lt;n&gt;', 'run a block n times'],
      ['repeat while &lt;cond&gt;', 'while the condition holds'],
      ['repeat until &lt;cond&gt;', 'until the condition holds'],
      ['repeat forever', 'until exit repeat or stop'],
      ['exit repeat', 'leave the loop'],
      ['next repeat', 'skip to the next pass'],
    ],
    code: `repeat 10
  move this right by 10 in 0.1 seconds
end

repeat while score < 100
  score = score + 5
end

repeat until answer == 1
  yesno "Ready?"
end`,
  },
  {
    title: 'Expressions',
    isNew: true,
    rows: [
      ['( )', 'group to control order'],
      ['a + b * c', 'multiplication binds tighter'],
    ],
    code: `total = (base + bonus) * 2
avg = (a + b + c) / 3`,
    note: 'The web version allowed only one operator per line; full expressions work here.',
  },
  {
    title: 'Other',
    rows: [
      ['stop', 'halt the script'],
      ['-- text', 'comment'],
    ],
  },
];

export function buildReference() {
  const wrap = document.createElement('div');
  wrap.id = 'reference-body';

  for (const s of SECTIONS) {
    const sec = document.createElement('div');
    sec.className = 'ref-section';

    const h = document.createElement('h3');
    h.textContent = s.title;
    if (s.isNew) {
      const tag = document.createElement('span');
      tag.className = 'ref-new';
      tag.textContent = 'new';
      h.appendChild(tag);
    }
    sec.appendChild(h);

    if (s.rows?.length) {
      const table = document.createElement('table');
      table.className = 'ref-table';
      const tbody = document.createElement('tbody');
      for (const [cmd, desc, isNew] of s.rows) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        td1.innerHTML = cmd;
        const td2 = document.createElement('td');
        td2.innerHTML = desc + (isNew ? ' <span class="ref-new">new</span>' : '');
        tr.append(td1, td2);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      sec.appendChild(table);
    }

    if (s.code) {
      const pre = document.createElement('pre');
      pre.className = 'ref-code';
      pre.textContent = s.code;
      sec.appendChild(pre);
    }

    if (s.note) {
      const p = document.createElement('p');
      p.style.cssText =
        'color:var(--text-muted);font-size:var(--text-xs);margin:8px 0 0;line-height:1.5';
      p.textContent = s.note;
      sec.appendChild(p);
    }

    wrap.appendChild(sec);
  }
  return wrap;
}
