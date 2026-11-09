// Offline reading presentation. Text is never parsed as HTML and input values are untouched.
// Product vocabulary overrides: 重置 means reset, pronounced chóng zhì.
pinyinPro.customPinyin({"重置":"chóng zhì"});
function beaaReadings(text){return pinyinPro.pinyin(String(text),{toneType:'symbol',nonZh:'consecutive'});}
function beaaAnnotate(root){
 if(!root||typeof document.createTreeWalker!=='function')return;
 const forbidden='script,style,ruby,textarea,input,option,[contenteditable="true"],[data-no-pinyin]';
 if(root.nodeType===1&&root.closest(forbidden))return;
 root.querySelectorAll?.('label[for]').forEach(label=>{const control=document.getElementById(label.htmlFor);if(control&&!control.hasAttribute('aria-label'))control.setAttribute('aria-label',label.textContent);});
 const walker=document.createTreeWalker(root,4);const nodes=[];
 while(walker.nextNode()){const node=walker.currentNode;if(/[\u3400-\u9fff]/u.test(node.data)&&!node.parentElement?.closest(forbidden))nodes.push(node);}
 for(const node of nodes){const ruby=document.createElement('ruby'),base=document.createElement('span'),reading=document.createElement('rt');
 base.textContent=node.data;reading.textContent=beaaReadings(node.data);reading.setAttribute('aria-hidden','true');ruby.append(base,reading);node.replaceWith(ruby);}
 // Native select menus cannot display ruby; keep option values and put reading after the original label.
 root.querySelectorAll?.('option:not([data-reading])').forEach(option=>{if(/[\u3400-\u9fff]/u.test(option.textContent)){option.dataset.reading='true';option.textContent+=' · '+beaaReadings(option.textContent);}});
}
if(typeof window!=='undefined'){
 window.beaaReadings=beaaReadings;window.beaaAnnotate=beaaAnnotate;
 const begin=()=>{beaaAnnotate(document.body);const observer=new MutationObserver(records=>{
  const roots=new Set();for(const record of records){const element=record.target.nodeType===1?record.target:record.target.parentElement;if(element&&!element.closest('ruby,script,style'))roots.add(element);}
  for(const root of roots)beaaAnnotate(root);
 });observer.observe(document.body,{childList:true,subtree:true,characterData:true});};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});else begin();
}
