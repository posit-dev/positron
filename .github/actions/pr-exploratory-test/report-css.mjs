/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The report's stylesheet. Both themes share every rule below the token block:
// only the custom properties and the three font families differ, so a layout
// change lands in both themes at once and cannot drift between them.

/** Professional: calm, warm, editorial. The default. */
const PROFESSIONAL = `
	--page: #F6F5F1;
	--card: #FFFFFF;
	--border: #E7E4DC;
	--hairline: #EFEDE7;
	--thead: #FBFAF7;
	--ink: #1C1F23;
	--body: #3D4148;
	--muted: #6A6F76;
	--faint: #8A8F96;
	--faint-rate: #7A7F86;
	--secondary: #4F535A;
	--dot-neutral: #CFCAC0;
	--sep: #B8B4AA;
	--divider: #CFCAC0;
	--hover-border: #CFCAC0;
	--code-bg: #EFEDE7;
	--code-text: #2B2F35;
	--link: #2F5F8A;
	--link-hover: #1E4466;

	--major-dot: #D1492F;
	--major-text: #A12C1F;
	--major-bg: #FBECE9;
	--moderate-dot: #D9953A;
	--moderate-text: #8F530A;
	--moderate-bg: #FCF1E1;
	--minor-dot: #A3ABB6;
	--minor-text: #4A5563;
	--minor-bg: #EEF0F3;
	--pass-fill: #3E8E62;
	--pass-text: #2F7A4F;
	--pass-bg: #E8F3EC;
	--notrun: #E2DFD7;

	--observed-bg: #FBF5F3;
	--observed-rule: #D8654F;
	--observed-label: #A12C1F;
	--expected-bg: #F7F6F2;
	--expected-rule: #A7ACB2;
	--expected-label: #3D4148;

	--thumb-border: #EFEDE7;
	--thumb-a: #F9F8F5;
	--thumb-b: #F3F1EC;
	--quiet: #767B82;
	--dash: #D9D5CB;
	--hypothesis: #8A8F96;
	--ref: #767B82;
	--ref-hover: #2F5F8A;
	--em-dash: #A3A7AD;

	--label-color: var(--muted);
	--label-ls: 0.1em;
	--label-font: var(--sans);
	--label-weight: 600;
	--eyebrow-ls: 0.12em;
	--eyebrow-color: var(--muted);
	--eyebrow-weight: 600;

	--num-color: var(--ink);
	--num-size: 30px;
	--num-weight: 600;
	--num-font: var(--sans);

	--display: 'Source Serif 4', Georgia, 'Times New Roman', serif;
	--sans: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
	--mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

	--card-shadow: none;
	--tile-shadow: none;
	--major-card-shadow: none;
	--focus: #2F5F8A;

	--sig-bug: #6A6F76;
	--sig-bug-glow: none;
	--sig-medium: #6A6F76;
	--sig-bang: #A12C1F;
	--sig-ok: #2F7A4F;
	--sig-ok-glow: none;

	--lb-backdrop: rgba(28,31,35,.72);
	--lb-shadow: 0 12px 40px rgba(28,31,35,.18);

	--tip-bg: #FFFFFF;
	--tip-border: #E7E4DC;
	--tip-text: #3D4148;
	--tip-shadow: 0 1px 2px rgba(28,31,35,0.06);

	--totop-bg: #FFFFFF;
	--totop-border: #E7E4DC;
	--totop-icon: #3D4148;
	--totop-icon-hover: #1C1F23;
	--totop-shadow: 0 2px 8px rgba(28,31,35,.08);

	--switch-bg: #FFFFFF;
	--switch-border: #E7E4DC;
	--switch-on-bg: #ECE9E2;
	--switch-on-icon: #2B2F35;
	--switch-on-shadow: inset 0 0 0 1px #DCD7CC;
	--switch-off-icon: #6F747B;
	--switch-off-hover-icon: #2B2F35;
	--switch-off-hover-bg: transparent;
`;

/** Party: dark 80s synthwave. */
const PARTY = `
	--page: #15102B;
	--card: #1E1838;
	--border: #342A5C;
	--hairline: #2A2250;
	--thead: #241D42;
	--ink: #F5F1FF;
	--body: #CFC8EA;
	--muted: #9D95C6;
	--faint: #8A82B8;
	--faint-rate: #8A82B8;
	--secondary: #B8B0DE;
	--dot-neutral: #4E4580;
	--sep: #5B4F92;
	--divider: #4A3F7A;
	--hover-border: #5B4F92;
	--code-bg: #2A2250;
	--code-text: #EDE7FF;
	--link: #5CE1E6;
	--link-hover: #9AF0F2;

	--major-dot: #FF4F81;
	--major-text: #FF8FA8;
	--major-bg: #3A1834;
	--moderate-dot: #FFB547;
	--moderate-text: #FFC56E;
	--moderate-bg: #3A2A1C;
	--minor-dot: #8E86C4;
	--minor-text: #C9C2EE;
	--minor-bg: #2C2654;
	--pass-fill: #3BD69E;
	--pass-text: #4BE8B0;
	--pass-bg: #17352C;
	--notrun: #3A3068;

	--observed-bg: #2A1733;
	--observed-rule: #FF4F81;
	--observed-label: #FF8FA8;
	--expected-bg: #221C40;
	--expected-rule: #6A61A0;
	--expected-label: #CFC8EA;

	--thumb-border: #2A2250;
	--thumb-a: #1C1636;
	--thumb-b: #19132F;
	--quiet: #948DBF;
	--dash: #4A3F7A;
	--hypothesis: #8A82B8;
	--ref: #948DBF;
	--ref-hover: #5CE1E6;
	--em-dash: #6A61A0;

	--label-color: #FF6AC1;
	--label-ls: 0.14em;
	--label-font: 'Chakra Petch', var(--sans);
	--label-weight: 600;
	--eyebrow-ls: 0.16em;
	--eyebrow-color: #FF6AC1;
	--eyebrow-weight: 700;

	--num-color: #5CE1E6;
	--num-size: 34px;
	--num-weight: 700;
	--num-font: 'Chakra Petch', var(--sans);

	--display: 'Chakra Petch', var(--sans);
	--sans: 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif;
	--mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

	--card-shadow: 6px 6px 0 #0B0719;
	--tile-shadow: 6px 6px 0 #0B0719;
	--major-card-shadow: 0 0 0 1px #FF4F81, 0 0 32px rgba(255,79,129,0.18);
	--focus: #5CE1E6;

	--sig-bug: #FF6AC1;
	--sig-bug-glow: drop-shadow(0 0 3px rgba(255,106,193,.6));
	--sig-medium: #C4BCEB;
	--sig-bang: #FF6AC1;
	--sig-ok: #5CE1E6;
	--sig-ok-glow: drop-shadow(0 0 4px rgba(92,225,230,.75));

	--lb-backdrop: rgba(10,7,25,.84);
	--lb-shadow: 8px 8px 0 #0B0719;

	--tip-bg: #241D42;
	--tip-border: #5B4F92;
	--tip-text: #F5F1FF;
	--tip-shadow: none;

	--totop-bg: #1E1838;
	--totop-border: #342A5C;
	--totop-icon: #C4BCEB;
	--totop-icon-hover: #F5F1FF;
	--totop-shadow: 4px 4px 0 #0B0719;

	--switch-bg: #1E1838;
	--switch-border: #342A5C;
	--switch-on-bg: #FF6AC1;
	--switch-on-icon: #15102B;
	--switch-on-shadow: 0 0 12px rgba(255,106,193,.45);
	--switch-off-icon: #C4BCEB;
	--switch-off-hover-icon: #F5F1FF;
	--switch-off-hover-bg: rgba(197,188,235,.07);
`;

export const FONT_HREF = 'https://fonts.googleapis.com/css2'
	+ '?family=IBM+Plex+Mono:wght@400;500'
	+ '&family=IBM+Plex+Sans:wght@400;500;600'
	+ '&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600'
	+ '&family=Figtree:wght@400;500;600;700'
	+ '&family=Chakra+Petch:wght@500;600;700'
	+ '&display=swap';

export const REPORT_CSS = `
:root[data-theme="professional"]{${PROFESSIONAL}}
:root[data-theme="party"]{${PARTY}}

*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition-duration:.01ms !important;animation-duration:.01ms !important}}
body{margin:0;background:var(--page);color:var(--body);font-family:var(--sans);-webkit-font-smoothing:antialiased}
p{margin:0}
a{color:var(--link);text-decoration:none}
a:hover{color:var(--link-hover);text-decoration:underline}
/* A symbol name has no break opportunities, so one long enough to outrun the
   viewport pushed the whole page sideways on a phone. */
code{font-family:var(--mono);font-size:0.86em;background:var(--code-bg);color:var(--code-text);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
/* A block of source is one surface, not a pill per line. Without this the
   inline code styling above was all a fenced block got, so a repro step that
   pasted a notebook cell came out as a stack of grey fragments. */
pre{margin:8px 0;padding:12px 14px;background:var(--code-bg);border-radius:8px;overflow-x:auto}
pre code{display:block;background:none;padding:0;font-size:12px;line-height:1.6;white-space:pre;overflow-wrap:normal}
ol{margin:0;padding-left:20px}
ol li{margin:0 0 8px;padding-left:4px}
ol li:last-child{margin-bottom:0}
img{max-width:100%}

/* The gutter is a token because the Party motif bleeds out to the page edge by
   exactly this much; hardcoding the desktop value pushed it past the viewport
   on a phone. */
/* One measure for every run of prose on the page. Containers stay full card
   width; only the text inside them is capped, so every box edge lines up with
   the card and every paragraph ends on the same line. */
:root{--gutter:32px;--measure:800px}
.page{width:100%;padding:56px var(--gutter) 80px;background:var(--page)}
.wrap{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:40px}

/* Header */
.head{position:relative;display:flex;flex-direction:column;gap:16px}
/* The switch sits over this row, so the row keeps clear of it: on a phone, or
   with a long branch name, the chips otherwise wrapped underneath it. */
.eyebrow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12px;color:var(--muted);padding-right:80px;min-height:36px}
.eyebrow .kicker{text-transform:uppercase;letter-spacing:var(--eyebrow-ls);font-weight:var(--eyebrow-weight);color:var(--eyebrow-color);font-family:var(--label-font)}
.eyebrow .bullet{width:3px;height:3px;border-radius:50%;background:var(--sep)}
h1.title{margin:0;font-family:var(--display);font-weight:600;font-size:34px;line-height:1.22;letter-spacing:-0.01em;color:var(--ink);max-width:var(--measure)}
.lead{font-size:16px;line-height:1.6;color:var(--body);max-width:var(--measure)}
.lead strong{color:var(--ink);font-weight:600}

/* Party motif: a neon grid floor under the lead. Professional has none, and
   that restraint is part of its character. */
.motif{display:none}
:root[data-theme="party"] .head{padding-bottom:180px;margin-bottom:-24px}
:root[data-theme="party"] .motif{display:block;position:absolute;left:calc(-1 * var(--gutter));right:calc(-1 * var(--gutter));bottom:0;height:170px;overflow:hidden;pointer-events:none;
	-webkit-mask-image:radial-gradient(ellipse 60% 120% at 50% 100%, #000 45%, transparent 100%),linear-gradient(to top, transparent 0, rgba(0,0,0,.35) 22px, #000 48px);
	-webkit-mask-composite:source-in;
	mask-image:radial-gradient(ellipse 60% 120% at 50% 100%, #000 45%, transparent 100%),linear-gradient(to top, transparent 0, rgba(0,0,0,.35) 22px, #000 48px);
	mask-composite:intersect}
.motif .plane{position:absolute;left:-100%;right:-100%;top:0;height:900px;transform-origin:50% 0;transform:perspective(360px) rotateX(58deg);
	background-image:linear-gradient(90deg, rgba(255,106,193,0.5) 1px, transparent 1px),linear-gradient(0deg, rgba(255,106,193,0.5) 1px, transparent 1px);
	background-size:64px 64px;background-position:center top}
.motif .horizon{position:absolute;left:0;right:0;top:0;height:1px;background:rgba(92,225,230,0.5);box-shadow:0 0 12px rgba(92,225,230,0.6)}

/* Theme switch */
.switch{position:absolute;top:-4px;right:0;display:inline-flex;gap:2px;padding:3px;border:1px solid var(--switch-border);border-radius:999px;background:var(--switch-bg);z-index:2}
.switch button{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--switch-off-icon);cursor:pointer;transition:background-color .15s ease,color .15s ease,box-shadow .15s ease}
.switch button:hover{color:var(--switch-off-hover-icon);background:var(--switch-off-hover-bg)}
.switch button[aria-pressed="true"]{background:var(--switch-on-bg);color:var(--switch-on-icon);box-shadow:var(--switch-on-shadow)}
.switch button[aria-pressed="true"]:hover{background:var(--switch-on-bg);color:var(--switch-on-icon)}
.switch button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}

/* One tooltip style for the whole page: tiles, theme switch, back to top. */
.tip{position:relative}
.tip::after{content:attr(data-tip);position:absolute;white-space:nowrap;padding:2px 7px;border-radius:5px;background:var(--tip-bg);color:var(--tip-text);border:1px solid var(--tip-border);box-shadow:var(--tip-shadow);font-family:var(--sans);font-size:11px;font-weight:500;line-height:1.5;letter-spacing:0;text-transform:none;pointer-events:none;opacity:0;transition:opacity .15s ease;z-index:3}
.tip:hover::after,.tip:focus-visible::after{opacity:1}
.switch .tip::after{top:calc(100% + 6px);right:0}

/* Summary tiles */
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--tile-shadow);padding:18px 20px;display:flex;flex-direction:column;gap:12px;position:relative;color:inherit;text-decoration:none;transition:border-color .15s ease}
.tile::after{bottom:calc(100% + 5px);right:10px}
a.tile:hover{border-color:var(--hover-border);text-decoration:none;color:inherit}
a.tile:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.tile-arrow{position:absolute;top:16px;right:16px;opacity:0;color:var(--muted);transition:opacity .15s ease}
a.tile:hover .tile-arrow,a.tile:focus-visible .tile-arrow{opacity:1}
.tile-label{font-size:12px;font-weight:500;color:var(--muted)}
.tile-num{font-family:var(--num-font);font-size:var(--num-size);font-weight:var(--num-weight);color:var(--num-color);line-height:1}
.tile-figure{display:flex;align-items:baseline;gap:6px}
.tile-figure .unit{font-size:14px;color:var(--muted)}
.tile-bar{display:flex;gap:3px;height:6px}
.tile-bar span{border-radius:3px}
.tile-note{display:flex;gap:16px;white-space:nowrap;font-size:12px;color:var(--muted);line-height:1.6;font-family:var(--mono)}
.tile-note.stack{display:block}

/* Section labels */
.section{display:flex;flex-direction:column;gap:14px;scroll-margin-top:24px}
.section-label{margin:0;font-family:var(--label-font);font-size:13px;font-weight:var(--label-weight);letter-spacing:var(--label-ls);text-transform:uppercase;color:var(--label-color)}
.section-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px}
.section-head .aside{font-size:13px;color:var(--muted)}

/* Grid tables: findings list, coverage, not exercised */
/* Panels carry no shadow in either theme: the Party offset shadow marks a card
   or a tile, and putting one on a full-width table read as a second surface. */
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.row{display:grid;gap:16px;padding:16px 20px;border-bottom:1px solid var(--hairline);align-items:start;color:inherit;text-decoration:none}
.row:last-child{border-bottom:0}
a.row:hover{text-decoration:none;color:inherit;background:var(--thead)}
a.row:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.row-head{padding:12px 20px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--muted);background:var(--thead)}
.findings-grid{grid-template-columns:110px minmax(0,1fr) 90px 110px}
.coverage-grid{grid-template-columns:minmax(0,5fr) minmax(0,7fr) 200px}
.right{text-align:right}

.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.pill .dot{width:6px;height:6px;border-radius:50%;align-self:center}
.sev-major{background:var(--major-bg);color:var(--major-text)}
.sev-major .dot{background:var(--major-dot)}
.sev-moderate{background:var(--moderate-bg);color:var(--moderate-text)}
.sev-moderate .dot{background:var(--moderate-dot)}
.sev-minor{background:var(--minor-bg);color:var(--minor-text)}
.sev-minor .dot{background:var(--minor-dot)}

.finding-cell{display:flex;flex-direction:column;gap:4px}
.finding-cell .claim{font-size:15px;font-weight:500;color:var(--ink);line-height:1.4}
.finding-cell .claim .n{font-family:var(--mono);color:var(--faint);margin-right:8px}
.finding-cell .impact{font-size:13px;color:var(--muted)}
.rate{text-align:right;font-family:var(--mono);font-size:13px;color:var(--body)}
.status{display:flex;justify-content:flex-end;align-items:center;gap:6px;font-size:13px;color:var(--pass-text)}
.status.muted{color:var(--muted)}

/* Finding cards */
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:32px;display:flex;flex-direction:column;gap:28px;box-shadow:var(--card-shadow);scroll-margin-top:24px}
.card.major{box-shadow:var(--major-card-shadow)}
.card > header{display:flex;flex-direction:column;gap:12px}

/* The meta line is one type token: 12px on one baseline. Hierarchy comes from
   weight, colour, icon and badge, never from size. */
.meta{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:14px;row-gap:6px;font-size:12px;line-height:18px}
.meta .group{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.meta .group.identity{gap:10px}
/* The one place the meta row's single type size is broken, deliberately: an
   uppercase kicker for the title, in the same family as REPRODUCE and EVIDENCE.
   At 11px its capitals stand as tall as the row's 12px lowercase, so it still
   sits on the shared baseline, and being muted it introduces the finding
   without competing with the severity badge beside it. */
.meta .who{font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted)}
.meta .group.context{color:var(--muted)}
.meta .rule{align-self:center;width:1px;height:12px;background:var(--divider)}
.meta .sep{color:var(--sep)}
.meta .origin.unchecked{font-style:italic}
.meta .confirmed{display:inline-flex;align-items:baseline;gap:4px;color:var(--muted);font-weight:400}
.meta .confirmed svg{align-self:center;color:var(--pass-text)}
.meta .reproduced{color:var(--faint-rate)}

h2.card-title{margin:0;font-family:var(--display);font-size:24px;font-weight:600;line-height:1.3;color:var(--ink)}
.card-summary{font-size:15px;line-height:1.65;color:var(--body);max-width:var(--measure)}

/* Observed | Expected: the strongest sub-section in the card. */
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.oe{border-radius:0 8px 8px 0;padding:14px 18px 16px;display:flex;flex-direction:column;gap:6px}
.oe .oe-label{font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase}
.oe p{font-size:15px;line-height:1.6;color:var(--ink)}
.oe.observed{background:var(--observed-bg);border-left:3px solid var(--observed-rule)}
.oe.observed .oe-label{color:var(--observed-label)}
.oe.expected{background:var(--expected-bg);border-left:3px solid var(--expected-rule)}
.oe.expected .oe-label{color:var(--expected-label)}

/* One style for every secondary heading: darker than supporting text, but with
   no panel or rule, so Observed and Expected stay dominant. */
.sub{font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--body)}
.sub .hyp{font-weight:500;color:var(--hypothesis)}

/* Reproduce answers "how do I make this happen?", so it is text only and one
   column. Screenshots all live under Evidence, which answers "show me that it
   happened"; a featured shot here meant the same image appeared twice. */
.repro{display:flex;flex-direction:column;gap:10px;max-width:var(--measure);margin-top:8px}
/* What must be true first, then what to do: two labelled groups so a reader can
   tell setup from actions at a glance instead of reading a paragraph to find
   where one ends. */
.repro-group{display:flex;flex-direction:column;gap:4px}
.repro-group.steps{margin-top:4px}
.repro-label{font-size:12px;font-weight:600;color:var(--body)}
/* Set exactly as the steps are -- 14px, the same indent, the same spacing --
   because they are read the same way. Only the marker and the slightly lighter
   tone separate them, so the two groups read as one list of instructions in two
   parts rather than a caption above a list. */
.preconditions{margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:var(--secondary)}
.preconditions li{margin:0 0 8px;padding-left:4px}
.preconditions li:last-child{margin-bottom:0}
.repro-steps{font-size:14px;line-height:1.6;color:var(--body)}

figure{margin:0;display:flex;flex-direction:column;gap:8px}
figure img{display:block;width:100%;height:auto;border:1px solid var(--thumb-border);border-radius:8px;background:repeating-linear-gradient(135deg,var(--thumb-a) 0 10px,var(--thumb-b) 10px 20px)}
figcaption{font-size:12px;line-height:1.4;color:var(--quiet)}

.evidence{display:flex;flex-direction:column;gap:10px}
/* The gallery takes its column count from how much there is to show: three
   screenshots stretched across a four-column grid left a hole where a reader
   looks for a fourth. */
.shots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.shots.n1{grid-template-columns:minmax(0,560px)}
.shots.n2{grid-template-columns:repeat(2,minmax(0,1fr))}
.shots.n3{grid-template-columns:repeat(3,minmax(0,1fr))}
.shots figure{gap:6px}
.shots img{aspect-ratio:16/10;object-fit:cover;object-position:top center;border-radius:6px}
a.shot{display:block;border-radius:6px;cursor:zoom-in;text-decoration:none}
a.shot img{transition:border-color .15s ease}
a.shot:hover img{border-color:var(--hover-border)}
a.shot:hover{text-decoration:none}
a.shot:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.logtile{border:1px solid var(--thumb-border);border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:var(--thead);min-width:0}
.logtile .path{font-family:var(--mono);font-size:11px;color:var(--quiet);word-break:break-all}
.logtile .quote{font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--quiet);word-break:break-word}
.logtile .note{font-size:12px;color:var(--quiet)}

/* Likely cause reads as analysis, not fact: dashed, no fill. */
.cause{border:1px dashed var(--dash);border-radius:10px;padding:16px 20px;display:flex;flex-direction:column;gap:8px}
.cause p{font-size:14px;line-height:1.65;color:var(--body);max-width:var(--measure)}
.card-prose{font-size:15px;line-height:1.65;color:var(--body)}

/* Coverage */
.cov-group{display:flex;flex-direction:column;gap:10px}
.cov-group.gap{margin-top:12px}
h3.cov-title{margin:0;font-size:14px;font-weight:600;color:var(--body)}
.cov-title .cov-n{font-weight:400;color:var(--faint)}
/* The status dot sits inside the scenario cell, not in a column of its own: it
   belongs to that scenario. The gap is wider than bullet-list spacing so the
   dot reads as a status marker rather than a bullet, and the top margin centres
   it on the first line, so a scenario that wraps keeps its dot beside line one.
   The two header indents below are this gap plus the dot, so they move with
   it. */
.cov-scenario{display:flex;align-items:flex-start;gap:15px;color:var(--ink)}
.cov-dot{flex:none;width:8px;height:8px;margin-top:7px;border-radius:50%}
.cov-dot.pass{background:var(--pass-fill)}
.cov-dot.issue{background:var(--moderate-dot)}
.cov-dot.none{width:7px;height:7px;background:var(--dot-neutral)}
/* Indented by the dot plus the gap, so the label starts where the text does. */
.cov-head-scenario{padding-left:23px}
.panel.dashed .cov-head-scenario{padding-left:22px}
.cov-result{color:var(--body)}
.cov-reason{color:var(--body);grid-column:span 2}
.ref{font-family:var(--mono);font-size:11.5px;color:var(--ref)}
a.ref:hover{color:var(--ref-hover)}
.ref.none{color:var(--em-dash);font-size:12px;font-family:var(--sans)}
.panel.dashed{border:1px dashed var(--dash)}
.panel.dashed .row{border-bottom-color:var(--hairline)}

/* Collapsible sections */
.folds{display:flex;flex-direction:column;border-top:1px solid var(--border)}
.folds details{border-bottom:1px solid var(--border);scroll-margin-top:24px}
.folds summary{display:flex;align-items:center;gap:10px;padding:16px 0;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer;list-style:none}
.folds summary::-webkit-details-marker{display:none}
.folds summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.folds summary .hint{font-weight:400;color:var(--muted);font-size:13px}
.chev{flex:none;transition:transform .15s ease;color:var(--muted)}
.folds details[open] .chev{transform:rotate(90deg)}
.fold-body{padding:0 0 20px 24px;display:flex;flex-direction:column;gap:16px;font-size:14px;line-height:1.65;color:var(--body);max-width:var(--measure)}
.fold-body p{margin:0 0 10px}
.fold-body p:last-child{margin-bottom:0}
.fold-part{display:flex;flex-direction:column;gap:4px}
.fold-part .fold-label{font-size:12px;font-weight:600;color:var(--muted)}
.verdicts{display:flex;flex-wrap:wrap;gap:8px}
.verdict{font-family:var(--mono);font-size:12px;padding:3px 8px;border-radius:6px;background:var(--pass-bg);color:var(--pass-text)}
.verdict.disputed{background:var(--major-bg);color:var(--major-text)}
.verdict.unresolved{background:var(--minor-bg);color:var(--minor-text)}

/* A maker's mark, not a section: a bug is found, looked at and fixed, in the
   time it takes to notice it. The run's cost lives on the Run tile; repeating
   it here made the page end on an invoice. */
footer.sig{display:flex;flex-direction:column;align-items:center;gap:12px;padding:56px 0 8px}
.sig p{margin:0;font-family:var(--mono);font-size:11px;color:var(--faint)}
.sig-link{color:var(--muted);text-decoration:none}
.sig-link:hover{color:var(--link);text-decoration:underline}

/* The performance still takes 7s; the cycle is 11. Every beat below is its old
   percentage scaled by 7/11, so the animation itself is paced exactly as
   before -- the extra four seconds are an empty dotted line at the end. It
   reads as a mark that occasionally does something rather than a loop, which
   needs the resting state to be the plain footer: resting on the check would
   leave a result sitting there as though it belonged to this report. */
.sg{position:relative;width:180px;height:40px;--sig-loop:11s}
.sg-line{position:absolute;left:0;right:0;bottom:3px;border-bottom:1.5px dotted var(--divider)}
.sg-bug{position:absolute;left:0;bottom:5px;display:block;width:16px;height:14px;color:var(--sig-bug);filter:var(--sig-bug-glow);opacity:0;animation:sg-bug var(--sig-loop) ease-in-out infinite}
.sg-bug svg{display:block}
.sg-mag{position:absolute;left:0;bottom:3px;color:var(--sig-medium);opacity:0;animation:sg-mag var(--sig-loop) ease-in-out infinite}
.sg-q,.sg-bang{position:absolute;bottom:22px;font-family:var(--mono);font-size:12px;font-weight:500;opacity:0}
.sg-q{left:124px;color:var(--sig-medium);animation:sg-q var(--sig-loop) ease infinite}
.sg-bang{left:66px;color:var(--sig-bang);animation:sg-bang var(--sig-loop) ease infinite}
.sg-pop{position:absolute;left:60px;bottom:6px;color:var(--sig-ok);filter:var(--sig-ok-glow);opacity:0;animation:sg-pop var(--sig-loop) ease infinite}
@keyframes sg-bug{0%{transform:translateX(0px) translateY(0px) rotate(90deg);opacity:0}2.5%{opacity:1}8.9%{transform:translateX(40px) translateY(0px) rotate(90deg)}12.7%{transform:translateX(32px) translateY(0px) rotate(-90deg)}19.1%,36.3%{transform:translateX(60px) translateY(0px) rotate(90deg)}37.5%{transform:translateX(60px) translateY(-9px) rotate(90deg)}38.8%{transform:translateX(60px) translateY(0px) rotate(90deg)}39.5%{transform:translateX(60px) translateY(-2px) rotate(90deg)}40.1%{transform:translateX(60px) translateY(0px) rotate(90deg);opacity:1}41.4%,100%{transform:translateX(60px) translateY(0px) rotate(90deg);opacity:0}}
@keyframes sg-mag{0%,3.8%{transform:translateX(-26px);opacity:0}7.6%{opacity:1}21.6%{transform:translateX(58px)}29.3%,33.1%{transform:translateX(114px)}36.9%,40.7%{transform:translateX(57px);opacity:1}42%,100%{transform:translateX(57px);opacity:0}}
@keyframes sg-q{0%,28.6%{opacity:0;transform:translateY(4px) scale(.6)}29.9%{opacity:1;transform:translateY(-1px) scale(1.25)}31.2%,33.1%{opacity:1;transform:translateY(0) scale(1)}34.4%,100%{opacity:0}}
@keyframes sg-bang{0%,36.3%{opacity:0;transform:translateY(4px) scale(.6)}37.5%{opacity:1;transform:translateY(-1px) scale(1.25)}38.8%,40.7%{opacity:1;transform:translateY(0) scale(1)}42%,100%{opacity:0}}
@keyframes sg-pop{0%,41.4%{opacity:0;transform:scale(.4)}43.9%{opacity:1;transform:scale(1.2)}45.8%,57.3%{opacity:1;transform:scale(1)}61.7%,100%{opacity:0}}
/* The magnifier leaves as the check arrives, in place, rather than drifting
   back down the line while it fades. The check is the answer to the question it
   was asking, so once the check is there the magnifier has nothing left to do
   and lingering read as though it were still looking. This is the one beat that
   departs from report-reference-*.html. */

/* Reduced motion keeps the punchline and drops the performance: the line and
   the check, which is what the mark is actually saying. */
@media (prefers-reduced-motion:reduce){
	.sg *{animation:none !important}
	.sg-pop{opacity:1}
	.sg-bug,.sg-mag,.sg-q,.sg-bang{opacity:0 !important}
}

/* Lightbox. The thumbnail is a real link to the raw image, so without
   JavaScript clicking it still shows the full size; the script intercepts and
   opens this instead. */
.lb[hidden]{display:none}
.lb{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:32px;background:var(--lb-backdrop)}
.lb-backdrop{position:absolute;inset:0;border:0;padding:0;background:transparent;cursor:zoom-out}
.lb-panel{position:relative;width:min(1040px,100%);max-height:100%;overflow:auto;padding:16px;border-radius:12px;background:var(--card);border:1px solid var(--border);box-shadow:var(--lb-shadow);display:flex;flex-direction:column;gap:12px}
.lb-panel img{display:block;width:100%;height:auto;max-height:calc(100vh - 220px);object-fit:contain;border-radius:8px;background:repeating-linear-gradient(135deg,var(--thumb-a) 0 12px,var(--thumb-b) 12px 24px)}
.lb-foot{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.lb-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.lb-cap{font-size:14px;line-height:1.5;color:var(--body)}
.lb-file{font-family:var(--mono);font-size:11px;color:var(--muted);word-break:break-all}
.lb-file a{font-family:var(--mono)}
.lb-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border-radius:999px;background:var(--card);border:1px solid var(--border);color:var(--body);cursor:pointer;transition:border-color .15s ease,color .15s ease}
.lb-close:hover{border-color:var(--hover-border);color:var(--ink)}
.lb-close:focus-visible{outline:2px solid var(--focus);outline-offset:2px}

/* Back to top */
.to-top{position:fixed;right:24px;bottom:24px;z-index:20;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:999px;background:var(--totop-bg);border:1px solid var(--totop-border);color:var(--totop-icon);box-shadow:var(--totop-shadow);text-decoration:none;opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease,border-color .15s ease,color .15s ease}
.to-top.show{opacity:1;pointer-events:auto;transform:translateY(0)}
.to-top:hover{border-color:var(--hover-border);color:var(--totop-icon-hover);text-decoration:none}
.to-top:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.to-top::after{right:calc(100% + 8px);top:50%;transform:translateY(-50%)}

@media (max-width:820px){
	:root{--gutter:16px}
	.tiles{grid-template-columns:minmax(0,1fr)}
	.two{grid-template-columns:minmax(0,1fr);gap:16px}
	.row{grid-template-columns:minmax(0,1fr) !important;gap:8px}
	.row-head{display:none}
	.cov-reason{grid-column:auto}
	.shots,.shots.n3{grid-template-columns:repeat(2,minmax(0,1fr))}
	.shots.n1{grid-template-columns:minmax(0,1fr)}
	.lb{padding:12px}
	.card{padding:20px}
	.rate,.status{text-align:left;justify-content:flex-start}
	.to-top{right:16px;bottom:16px}
	h1.title{font-size:28px}
}
`;
