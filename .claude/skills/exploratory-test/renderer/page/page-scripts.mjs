/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The page's own scripts, inline so the page stays one file: theme and share,
// copy buttons, the lightbox, feedback rows and the linked-issue previews.

import { FEEDBACK_ID_ENTRY } from './card-actions.mjs';
import { copyScript, ICON } from './page-common.mjs';

// The theme toggle shows the moon on light and the sun on dark, by CSS, so a
// saved choice applied before paint shows the right icon.
export const HEADER_ACTIONS = '<div class="hd-act hd-inline">'
	+ `<button type="button" class="mode-tip th-sw" data-tip="Switch to dark mode" aria-label="Switch to dark mode">${ICON.moon}${ICON.sun}</button>`
	+ '<button type="button" class="sh-btn" aria-label="Share: copy a link to this report">'
	+ `${ICON.link.replace('ln-ico', 'sh-ico')}${ICON.linked.replace('ln-ok', 'sh-ok')}<span class="sh-l">Share</span></button></div>`;

export const BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('exploratory-report-theme');
if(t==='party'||t==='professional'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export const PAGE_SCRIPT = `(function(){
var root=document.documentElement;
var sw=document.querySelector('.th-sw');
function apply(theme){root.setAttribute('data-theme',theme);
var label=theme==='party'?'Switch to light mode':'Switch to dark mode';sw.dataset.tip=label;sw.setAttribute('aria-label',label);}
sw.addEventListener('click',function(){var theme=root.getAttribute('data-theme')==='party'?'professional':'party';apply(theme);
try{localStorage.setItem('exploratory-report-theme',theme);}catch(e){}});
apply(root.getAttribute('data-theme')||'professional');

var share=document.querySelector('.sh-btn'),shareLabel=share.querySelector('.sh-l'),shareTimer;
share.addEventListener('click',function(){var text=location.href.split('#')[0];
try{history.replaceState(null,'',location.pathname+location.search);}catch(_){}
function done(){share.classList.add('is-copied');shareLabel.textContent='Copied';clearTimeout(shareTimer);
shareTimer=setTimeout(function(){share.classList.remove('is-copied');shareLabel.textContent='Share';},1600);}
${copyScript('text', 'done')}});

var top=document.querySelector('.to-top');
if(top){var sync=function(){var show=(window.scrollY||document.documentElement.scrollTop||0)>900;
top.classList.toggle('show',show);top.setAttribute('tabindex',show?'0':'-1');};
window.addEventListener('scroll',sync,{passive:true});sync();}

// The Run tile points at a collapsed section, so the jump has to open it or it
// lands the reader on a closed row.
function openRun(){var d=document.getElementById('run-details');if(d){d.open=true;}}
document.querySelectorAll('a[href="#run-details"]').forEach(function(a){a.addEventListener('click',openRun);});
window.addEventListener('hashchange',function(){if(location.hash==='#run-details'){openRun();}});
if(location.hash==='#run-details'){openRun();}
// A step's screenshot preview opens above its icon, or below when that would
// run off the top of the window.
document.querySelectorAll('a.st-ev .ev-pop').forEach(function(p){var a=p.parentNode;
function place(){a.classList.toggle('ev-below',a.getBoundingClientRect().top<p.offsetHeight+16);}
a.addEventListener('mouseenter',place);a.addEventListener('focus',place);});
// Lightbox. The thumbnails are links to the raw image, so everything here is an
// enhancement: without it, or before it runs, clicking one still shows the
// full-size screenshot.
var lb=document.getElementById('lightbox');
if(lb){
var img=lb.querySelector('img'),cap=lb.querySelector('.lb-cap'),file=lb.querySelector('.lb-file');
var closeBtn=lb.querySelector('.lb-close'),backdrop=lb.querySelector('.lb-backdrop'),pos=lb.querySelector('.lb-pos');
var prev=lb.querySelector('.lb-prev'),next=lb.querySelector('.lb-next');
var shots=Array.prototype.slice.call(document.querySelectorAll('a.shot,a.st-ev[data-lb]'));
var group=[],at=0,opener=null;
// A group is one step's stack, or one Coverage row's shots. It stops at
// either end rather than wrapping, so the position always reads true.
function show(i){if(i<0||i>=group.length){return;}at=i;var a=group[at];
img.src=a.getAttribute('href');img.alt=a.dataset.caption||'';
cap.textContent='';
if(a.dataset.step){var st=document.createElement(a.dataset.stepHref?'a':'span');st.className='lb-step';
st.textContent=a.dataset.step;if(a.dataset.stepHref){st.href=a.dataset.stepHref;
// Landing on the step is the point, so the opener does not take focus back.
st.addEventListener('click',function(){opener=null;close();});}
var dot=document.createElement('span');dot.className='step-sep';dot.setAttribute('aria-hidden','true');dot.textContent=' \u00b7 ';
cap.appendChild(st);cap.appendChild(dot);}
cap.appendChild(document.createTextNode(a.dataset.caption||''));
var many=group.length>1,what=a.dataset.step?' for '+a.dataset.step:'';
pos.hidden=!many;
if(many){pos.textContent=(at+1)+' / '+group.length;pos.setAttribute('aria-label','Screenshot '+(at+1)+' of '+group.length);}
[[prev,at===0,'Previous'],[next,at===group.length-1,'Next']].forEach(function(n){
n[0].hidden=!many;n[0].disabled=n[1];n[0].classList.toggle('dis',n[1]);
n[0].setAttribute('aria-label',n[2]+' screenshot'+what);});
// An arrow that just reached its end cannot hold focus, so it passes to the other.
if(document.activeElement.disabled){(document.activeElement===prev?next:prev).focus();}
file.innerHTML='';
var name=document.createTextNode((a.dataset.file||'')+' ');
var orig=document.createElement('a');orig.href=a.getAttribute('href');orig.target='_blank';
orig.rel='noreferrer';orig.textContent='Open original';
file.appendChild(name);file.appendChild(orig);
lb.setAttribute('aria-label',a.dataset.file||'Screenshot');}
function open(a){opener=a;
group=shots.filter(function(s){return s.dataset.lb===a.dataset.lb;});
show(group.indexOf(a));lb.hidden=false;closeBtn.focus();}
function close(){lb.hidden=true;img.removeAttribute('src');
if(opener){opener.focus();opener=null;}}
shots.forEach(function(a){a.addEventListener('click',function(e){
// Let a modified click do what the reader asked: a new tab on the raw image.
if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0){return;}
e.preventDefault();open(a);});});
// A finding step's icon opens its screenshot in the gallery's group.
document.querySelectorAll('a.st-ev[data-open]').forEach(function(a){a.addEventListener('click',function(e){
if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0){return;}
var t=document.getElementById(a.dataset.open);if(!t){return;}
e.preventDefault();open(t);opener=a;});});
closeBtn.addEventListener('click',close);backdrop.addEventListener('click',close);
prev.addEventListener('click',function(){show(at-1);});next.addEventListener('click',function(){show(at+1);});
document.addEventListener('keydown',function(e){
if(lb.hidden){return;}
if(e.key==='Escape'){e.preventDefault();close();}
else if(e.key==='ArrowRight'){e.preventDefault();show(at+1);}
else if(e.key==='ArrowLeft'){e.preventDefault();show(at-1);}
else if(e.key==='Tab'){
// Only a few controls are focusable, so the trap is a cycle between them.
var stops=[prev,next,lb.querySelector('.lb-cap a'),closeBtn,lb.querySelector('.lb-file a')].filter(function(b){return b&&!b.hidden&&!b.disabled;});
var i=stops.indexOf(document.activeElement);
e.preventDefault();
stops[(i+(e.shiftKey?-1:1)+stops.length)%stops.length].focus();}});
}
})();`;

// Forms open in one reused pop-up, which keeps its opener so a second click can
// reload it; a blocked pop-up falls back to a tab. A verdict is sent in a hidden
// frame instead. Only the verdict string is stored, and the row is rebuilt from
// the page's own links, since every report on the CDN shares one localStorage.
const CARET = '<svg class="fb-car" aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></svg>';
export const FEEDBACK_SCRIPT = `(function(){var NAME='exploratory-feedback',W=680,H=820,current=null;
function open(href){
if(current&&!current.closed){try{current.location.href=href;current.focus();return;}catch(e){}}
var w=Math.min(W,(screen.availWidth||W)-40),h=Math.min(H,(screen.availHeight||H)-80);
var left=Math.round((window.screenX||0)+Math.max(0,((window.outerWidth||w)-w)/2));
var top=Math.round((window.screenY||0)+Math.max(0,((window.outerHeight||h)-h)/3));
var win=window.open('',NAME,'popup,width='+w+',height='+h+',left='+left+',top='+top);
if(!win){window.open(href,'_blank','noopener');return;}
win.location.href=href;win.focus();current=win;}
function key(row){return 'fb:'+row.dataset.report+'#'+row.dataset.finding;}
function get(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function put(k,v){try{if(v){localStorage.setItem(k,v);}else{localStorage.removeItem(k);}}catch(e){}}
function verdicts(row){return Array.prototype.slice.call(row.querySelectorAll('a[data-verdict]'));}
var id=get('fb:id');if(!/^[0-9a-f]{12}$/.test(id||'')){id=Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(6)),function(x){return (x<16?'0':'')+x.toString(16);}).join('');put('fb:id',id);}
Array.prototype.slice.call(document.querySelectorAll('a[data-verdict]')).forEach(function(a){var add='&${FEEDBACK_ID_ENTRY}='+id;a.href+=add;a.dataset.submit+=add;});
function send(url){var f=document.createElement('iframe');f.hidden=true;f.setAttribute('aria-hidden','true');f.tabIndex=-1;f.src=url;
document.body.appendChild(f);setTimeout(function(){f.remove();},30000);}
function el(tag,cls,text){var e=document.createElement(tag);e.className=cls;e.textContent=text||'';e.setAttribute('data-answer','');return e;}
function answer(row,a){var done=el('button','fb-done tip');done.type='button';done.setAttribute('data-tip','Change answer');
done.setAttribute('aria-label','Your answer: '+a.textContent+'. Change answer');
done.innerHTML='${ICON.check(12)}<span></span>${CARET}';done.querySelector('span').textContent=a.textContent;
var note=el('a','fb-act fb-note','Add a note');note.href=a.href;note.target='_blank';note.rel='noopener';
verdicts(row).forEach(function(b){b.hidden=true;});
[done,note].forEach(function(e){row.appendChild(e);});
return note;}
function reset(row){Array.prototype.slice.call(row.querySelectorAll('[data-answer]')).forEach(function(e){e.remove();});
verdicts(row).forEach(function(b){b.hidden=false;});}
Array.prototype.slice.call(document.querySelectorAll('.fb[data-finding]')).forEach(function(row){var v=get(key(row));if(!v){return;}
var a=verdicts(row).filter(function(b){return b.dataset.verdict===v;})[0];
if(a){answer(row,a);}else{put(key(row),null);}});
document.addEventListener('click',function(e){var t=e.target&&e.target.closest?e.target:null;if(!t){return;}
var change=t.closest('.fb-done');
if(change){var row=change.closest('.fb');put(key(row),null);reset(row);verdicts(row)[0].focus();return;}
var a=t.closest('.fb a');
if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey){return;}
e.preventDefault();
if(a.dataset.submit){var r=a.closest('.fb');send(a.dataset.submit);put(key(r),a.dataset.verdict);answer(r,a).focus();return;}
open(a.href);});
})();`;

// One handler for the code and agent-prompt copy buttons. Only a copy that worked says "Copied".
export const COPY_SCRIPT = `document.querySelectorAll('.cp-btn,.code-cp').forEach(function(b){var t,tip=b.dataset.tip;
b.addEventListener('click',function(){var text;
// A code block copies its source exactly; the agent button copies its prompt.
if(b.classList.contains('code-cp')){var pre=b.parentNode.querySelector('pre');if(!pre){return;}text=pre.textContent;}
else{var el=document.getElementById(b.dataset.prompt);if(!el){return;}
// Undo scriptText's escapes, or the paste carries them.
text=el.textContent.trim().replace(/<\\\\(?=\\/script|!--)/gi,'<');}
function done(){b.classList.add('is-copied');b.dataset.tip='Copied';clearTimeout(t);
t=setTimeout(function(){b.classList.remove('is-copied');b.dataset.tip=tip;},2000);}
${copyScript('text', 'done')}});});`;

// Copy link: this page's URL with the finding's anchor. The address bar
// follows without scrolling or adding a history entry.
export const LINK_SCRIPT = `document.querySelectorAll('[data-link-to]').forEach(function(b){var t,tip=b.dataset.tip;
b.addEventListener('click',function(e){e.preventDefault();var id=b.dataset.linkTo;
var text=location.href.split('#')[0]+'#'+id;
try{history.replaceState(null,'','#'+id);}catch(_){}
function done(){b.classList.add('is-copied');b.dataset.tip='Link copied';clearTimeout(t);
t=setTimeout(function(){b.classList.remove('is-copied');b.dataset.tip=tip;},1600);}
${copyScript('text', 'done')}});});`;

// Inline code in steps: a click copies the chip. A drag-selection is left
// alone, so the usual copy still takes just what was selected. Not a control:
// no tab stop, since keyboard users select and copy as they already do.
export const CODE_CHIP_SCRIPT = `document.querySelectorAll('code.cc').forEach(function(c){var t;
c.addEventListener('click',function(){if(window.getSelection&&String(window.getSelection())){return;}
var text=c.textContent;
function done(){c.classList.add('is-copied');c.dataset.tip='Copied';clearTimeout(t);
t=setTimeout(function(){c.classList.remove('is-copied');c.dataset.tip='Copy';},1200);}
${copyScript('text', 'done')}});});`;

// A link too long for GitHub opens the form with the title only, so the click
// copies the description as well and says so. Only pages with such a link ship this.
export const ISSUE_SCRIPT = `(function(){var toast=document.createElement('div');toast.className='gh-toast';toast.setAttribute('role','status');
toast.innerHTML='${ICON.check(13)}<span></span>';document.body.appendChild(toast);var t;
function show(){toast.querySelector('span').textContent='Description copied. Paste it into the issue on GitHub.';
toast.classList.add('show');clearTimeout(t);t=setTimeout(function(){toast.classList.remove('show');},5000);}
document.querySelectorAll('.gh-btn[data-issue]').forEach(function(a){a.addEventListener('click',function(){
var el=document.getElementById(a.dataset.issue);if(!el){return;}
// Undo scriptText's escapes, or the paste carries them.
var text=el.textContent.replace(/<\\\\(?=\\/script|!--)/gi,'<');
${copyScript('text', 'show')}});});})();`;

// The Linked issues counts open their hidden list in one floating panel: on
// hover (it stays while the pointer is on it), keyboard focus, or tap. Enter or
// Space pins it, Escape closes it.
export const KI_LIST_SCRIPT = `(function(){var pop=document.createElement('div');pop.className='ki-lc';pop.id='ki-lc';pop.setAttribute('role','dialog');
document.body.appendChild(pop);var cur=null,pinned=false,t=null;
function place(a){var r=a.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight,m=12;
pop.style.left=Math.min(Math.max(m,r.left-12),window.innerWidth-w-m)+'px';
var top=r.bottom+8;if(top+h>window.innerHeight-m){top=Math.max(m,r.top-h-8);}pop.style.top=top+'px';}
function show(a,pin){clearTimeout(t);if(cur&&cur!==a){cur.setAttribute('aria-expanded','false');}
var src=document.getElementById(a.getAttribute('aria-controls'));if(!src){return;}
cur=a;pinned=!!pin;pop.innerHTML=src.innerHTML;pop.setAttribute('aria-label',(src.querySelector('.ki-lc-h')||{}).textContent||'');
pop.classList.add('is-open');a.setAttribute('aria-expanded','true');place(a);}
function hide(){clearTimeout(t);if(cur){cur.setAttribute('aria-expanded','false');}cur=null;pinned=false;pop.classList.remove('is-open');}
function later(){clearTimeout(t);t=setTimeout(function(){if(!pinned){hide();}},150);}
function cnt(e){return e.target.closest&&e.target.closest('.ki-cnt');}
function inPop(e){return e.target.closest&&e.target.closest('#ki-lc');}
document.addEventListener('mouseover',function(e){var a=cnt(e);
if(a){if(a!==cur){show(a,false);}else{clearTimeout(t);}return;}
if(inPop(e)){clearTimeout(t);return;}if(cur&&!pinned){later();}});
document.addEventListener('click',function(e){var a=cnt(e);
if(a){if(cur===a&&pinned){hide();}else{show(a,true);}return;}
if(cur&&!inPop(e)){hide();}});
document.addEventListener('keydown',function(e){var a=cnt(e);
if(a&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();if(cur===a&&pinned){hide();}else{show(a,true);}return;}
if(e.key==='Escape'&&cur){var back=cur;hide();back.focus();}},true);
document.addEventListener('focusin',function(e){var a=cnt(e);
if(a&&a.matches(':focus-visible')){show(a,false);}else if(cur&&!pinned&&!inPop(e)){hide();}});
window.addEventListener('scroll',function(){if(cur){place(cur);}},{passive:true});
window.addEventListener('resize',function(){if(cur){place(cur);}});})();`;

// The issue preview card: on hover and keyboard focus, Escape closes it; on
// touch the first tap previews and a second opens GitHub. A number inside a
// Findings row is a span, so it previews on mouse hover and the row click stands. Built with
// textContent from data attributes, which hold GitHub's text.
export const KI_SCRIPT = `(function(){var ICON={open:'<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>',
closed:'<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 8.2l1.8 1.8 3.2-3.6"/></svg>'};
var card=document.createElement('div');card.className='ki-card';card.id='ki-card';card.setAttribute('role','tooltip');document.body.appendChild(card);
var cur=null,tapped=null,pointer='mouse',SEL='a.ki-num[data-title],.ki-num-t[data-title]';
function el(tag,cls,text){var e=document.createElement(tag);if(cls){e.className=cls;}if(text!=null){e.textContent=text;}return e;}
function find(t){return t&&t.closest?t.closest(SEL):null;}
function build(a){var d=a.dataset,st=d.state==='merged'?'merged':d.state==='closed'?'closed':'open',pr=d.kind==='pr';card.textContent='';
var top=el('div','ki-card-top'),s=el('span','ki-s is-'+st);
s.innerHTML=ICON[st==='open'?'open':'closed'];s.appendChild(document.createTextNode(' '+{open:'Open',closed:'Closed',merged:'Merged'}[st]+(pr?' PR':'')));
top.appendChild(s);top.appendChild(el('span','ki-n',a.textContent));if(d.opened){top.appendChild(el('span','ki-d',d.opened));}
card.appendChild(top);card.appendChild(el('div','ki-card-t',d.title||''));
if(d.summary){card.appendChild(el('div','ki-card-x',d.summary));}
card.appendChild(el('div','ki-card-f','From the '+(pr?'PR':'issue')+'\\u2019s description'+(a.tagName!=='A'?'':' \\u00b7 '+(pointer==='touch'?'tap again':'click')+' to open on GitHub')));}
function place(a){var r=a.getBoundingClientRect(),w=card.offsetWidth,h=card.offsetHeight,m=12;
var left=Math.min(Math.max(m,r.left+r.width/2-w/2),window.innerWidth-w-m);
var top=r.top-h-8;if(top<m){top=r.bottom+8;}card.style.left=left+'px';card.style.top=top+'px';}
function show(a){if(cur&&cur!==a){cur.removeAttribute('aria-describedby');}cur=a;build(a);card.classList.add('is-open');a.setAttribute('aria-describedby','ki-card');place(a);}
function hide(){if(cur){cur.removeAttribute('aria-describedby');}cur=null;tapped=null;card.classList.remove('is-open');}
document.addEventListener('pointerdown',function(e){pointer=e.pointerType||'mouse';},true);
document.addEventListener('mouseover',function(e){if(pointer==='touch'){return;}var a=find(e.target);
if(a){if(a!==cur){show(a);}}else if(cur&&!cur.matches(':focus-visible')){hide();}});
document.addEventListener('focusin',function(e){var a=find(e.target);if(a&&a.matches(':focus-visible')){show(a);}});
document.addEventListener('focusout',function(e){if(cur&&e.target===cur&&pointer!=='touch'){hide();}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&cur){hide();}});
document.addEventListener('click',function(e){if(pointer!=='touch'){if(cur&&cur.tagName!=='A'){hide();}return;}var a=find(e.target);
if(!a||a.tagName!=='A'){if(cur){hide();}return;}if(tapped!==a){e.preventDefault();show(a);tapped=a;}else{tapped=null;}},true);
window.addEventListener('scroll',function(){if(cur){place(cur);}},{passive:true});
window.addEventListener('resize',function(){if(cur){place(cur);}});})();`;
