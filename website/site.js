"use strict";
const toggle=document.querySelector('.menu-toggle');
const nav=document.querySelector('#primary-nav');
if(toggle && nav){
  const close=()=>{toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation');nav.classList.remove('is-open')};
  toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');nav.classList.toggle('is-open',open)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  document.addEventListener('click',e=>{if(!nav.contains(e.target)&&!toggle.contains(e.target))close()});
}
const year=document.querySelector('#year');if(year)year.textContent=String(new Date().getFullYear());

// The static website never transmits or stores enquiry form values.
// A successful validation only opens a user-controlled WhatsApp/email draft.
const enquiryForm=document.querySelector('#enquiry-form');
if(enquiryForm){
  enquiryForm.hidden=false;
  const field=(name)=>enquiryForm.elements.namedItem(name).value.trim();
  enquiryForm.addEventListener('submit',event=>{
    event.preventDefault();
    if(!enquiryForm.reportValidity())return;
    const lines=[
      'PILLARSPEC SARL — SERVICE ENQUIRY',
      'Name: '+field('name'),
      field('company')?'Company: '+field('company'):null,
      'Reply contact: '+field('contact'),
      'Service: '+field('service'),
      'Port/location: '+field('location'),
      field('dates')?'Indicative dates: '+field('dates'):null,
      field('scope')?'Cargo, vessel & scope: '+field('scope'):null,
      'Please confirm scope and availability.'
    ].filter(Boolean);
    const message=lines.join('\n');
    const channel=field('channel');
    const destination=channel==='email'
      ?'mailto:KH@Pillarspec.com?subject='+encodeURIComponent('PillarSpec Service Enquiry')+'&body='+encodeURIComponent(message)
      :'https://wa.me/96178701617?text='+encodeURIComponent(message);
    const status=document.querySelector('#enquiry-status');
    if(status) status.textContent='Opening '+(channel==='email'?'your email app':'WhatsApp')+' with a draft. The enquiry is not sent until you press Send.';
    window.location.href=destination;
  });
}
