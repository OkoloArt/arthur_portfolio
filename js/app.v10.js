(function(){
  var root = document.documentElement, tb = document.getElementById('theme'), saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) {}
  function setTheme(t){ root.setAttribute('data-theme', t); tb.textContent = t === 'dark' ? 'Light' : 'Dark'; }
  setTheme(saved || 'dark');
  tb.addEventListener('click', function(){
    var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; setTheme(t);
    try { localStorage.setItem('theme', t); } catch (e) {}
  });
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function(s){ return document.querySelector(s); };
  var $$ = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var logEl = $('#log'), banner = $('#banner'), pipe = $('#pipe'), controls = $('#controls'), tabsEl = $('#tabs');
  var projectPicker = $('#project-picker');
  var nodes = [], clock = 0, runId = 0, current = 0;

  function isMobileLab(){ return window.matchMedia('(max-width:760px)').matches; }
  function isTabletLab(){ return window.matchMedia('(min-width:761px) and (max-width:1279px)').matches; }

  function setLabView(view){
    var p=$('#panel'); if(!p) return;
    p.dataset.labView=view;
    $$('.lab-mobile-nav [data-lab-view]').forEach(function(b){
      b.setAttribute('aria-pressed', b.dataset.labView===view ? 'true':'false');
    });
  }

  function setTabletView(view){
    var p=$('#panel'); if(!p) return;
    p.dataset.tabletView=view;
    $$('.lab-tablet-nav [data-tablet-view]').forEach(function(b){
      b.setAttribute('aria-pressed', b.dataset.tabletView===view ? 'true':'false');
    });
  }

  function setEventView(view){
    var p=$('#panel'); if(!p) return;
    p.dataset.eventView=view;
    $$('.android-event-switch [data-event-view]').forEach(function(b){
      b.setAttribute('aria-pressed', b.dataset.eventView===view ? 'true':'false');
    });
  }

  $$('.lab-mobile-nav [data-lab-view]').forEach(function(b){
    b.addEventListener('click', function(){ setLabView(b.dataset.labView); });
  });
  $$('.lab-tablet-nav [data-tablet-view]').forEach(function(b){
    b.addEventListener('click', function(){ setTabletView(b.dataset.tabletView); });
  });
  $$('.android-event-switch [data-event-view]').forEach(function(b){
    b.addEventListener('click', function(){ setEventView(b.dataset.eventView); });
  });
  var CANCEL = {};
  var rid = function(n){ return Math.random().toString(36).slice(2, 2 + n); };
  var pick = function(a){ return a[Math.floor(Math.random() * a.length)]; };

  var sims = [
    { id:'renegan', label:'Renegan', kind:'Backend', btn:'Run payment', path:'POST /payments',
      hint:'Rules: a viewer is denied. 5,000,000 NGN (or 10,000 in other currencies) is held for AML. An unfunded card triggers a retry.',
      auto:function(v){ var lim=v('cur')==='NGN'?5e6:1e4; if(v('role')==='viewer') return 'forbidden'; if(parseFloat(v('amount'))>=lim) return 'aml'; if(v('card')!=='Funded') return 'decline'; return 'settled'; },
      res:{settled:[201,{status:'succeeded',id:'{id}'}],aml:[202,{status:'held_for_review',reason:'aml_match'}],decline:[201,{status:'succeeded',attempts:2}],forbidden:[403,{error:'forbidden'}]},
      title:'Send a payment through the billing pipeline',
      blurb:'The flow I built for billing and compliance at Renegan: role checks, AML screening, provider retries and audit trails.',
      scenarios:[['auto','From inputs'],['settled','Settles'],['aml','AML flag'],['decline','Card declined'],['forbidden','No permission']],
      fields:[{id:'amount',label:'Amount',type:'number',value:250000},{id:'cur',key:'currency',label:'Currency',type:'select',options:['NGN','USD','GBP','EUR']},{id:'prov',key:'provider',label:'Provider',type:'select',options:['Flutterwave','Paystack']},{id:'role',label:'Role',type:'select',options:['finance_admin','viewer']},{id:'card',label:'Card',type:'select',options:['Funded','Insufficient funds']}],
      stages:[['Request','POST /payments, payload validated'],['Auth and RBAC','JWT check, then role and currency permission guard'],['AML screening','Identity extracted from the payload and screened'],['Payment provider','Charge, retry and grace logic, then verification'],['Ledger and invoice','Post the payment, generate the invoice, sync state'],['Events and audit','Notify and write a traceable audit entry']],
      run: async function(h){
        var cur=h.v('cur'), prov=h.v('prov'), amt=parseFloat(h.v('amount')); if(!(amt>0)) amt=250000;
        var money; try{ money=new Intl.NumberFormat('en-NG',{style:'currency',currency:cur}).format(amt); }catch(e){ money=cur+' '+amt; }
        var txn='txn_'+h.rid(6), ref=h.rid(8).toUpperCase(), role=h.s==='forbidden'?'viewer':'finance_admin';
        async function notify(evt,audit,state){ h.go(5); await h.sleep(350); h.log('events',evt); await h.sleep(220); h.log('audit',audit); h.pass(5,state||'logged'); }
        h.go(0); h.log('api','POST /payments '+money+' via '+prov); await h.sleep(500);
        h.log('api','Payload validated, '+txn+' created'); h.pass(0); await h.sleep(350);
        h.go(1); h.log('auth','JWT verified, role: '+role); await h.sleep(450);
        if(h.s==='forbidden'){
          h.log('auth','RBAC guard: role "viewer" cannot create '+cur+' payments','bad'); h.set(1,'fail','denied 403'); await h.sleep(350);
          h.skip([2,3,4]); await notify('payment.denied emitted','Denied attempt recorded with actor and role');
          return h.end('bad','Rejected with 403. The attempt is in the audit log.');
        }
        h.log('auth','RBAC guard: '+cur+' payments permitted','ok'); h.pass(1); await h.sleep(350);
        h.go(2); h.log('aml','Extracting identity from payload'); await h.sleep(450);
        h.log('aml','Screening against watchlists'); await h.sleep(550);
        if(h.s==='aml'){
          h.log('aml','Match found, risk: high. Payment held','warn'); h.set(2,'warn','flagged'); await h.sleep(350);
          h.skip([3,4]); await notify('compliance.alert queued','Screening result stored with extracted identity');
          return h.end('warn','Held for compliance review. No money moved.');
        }
        h.log('aml','No match, risk: low','ok'); h.pass(2); await h.sleep(350);
        h.go(3); h.log('gateway','Charging '+money+' via '+prov); await h.sleep(650);
        if(h.s==='decline'){
          h.log('gateway','Attempt 1 declined: insufficient funds','bad'); h.set(3,'warn','retrying'); await h.sleep(450);
          h.log('retry','Grace period opened, next attempt queued for +24h','warn'); await h.sleep(800);
          h.log('retry','Attempt 2 succeeded (simulated +24h)','ok'); await h.sleep(300);
        }
        h.log('gateway','Verified with '+prov+', ref '+ref,'ok'); h.pass(3,h.s==='decline'?'passed on retry':'passed'); await h.sleep(350);
        h.go(4); h.log('ledger','Posted '+money+' to the ledger'); await h.sleep(400);
        h.log('ledger','Invoice INV-'+h.rid(5).toUpperCase()+' generated'); await h.sleep(400);
        h.log('ledger','Post-payment sync complete','ok'); h.pass(4); await h.sleep(350);
        await notify('payment.succeeded emitted','Event written with '+txn+' and actor','passed');
        return h.end('ok',h.s==='decline'?'Settled after one retry. Invoice issued.':'Settled. Invoice issued.');
      } },

    { id:'blocktremp', label:'BlockTremp', kind:'Backend', btn:'Run BlockTremp flow', path:'POST /businesses',
      hint:'Registration rules: Lagos Fresh Foods Ltd is already registered and the valid phone code is 482913. PDF and analytics scenarios use their own inputs.',
      auto:function(v){ if(v('biz').trim().toLowerCase()==='lagos fresh foods ltd') return 'duplicate'; if(v('code').trim()!=='482913') return 'badcode'; return 'ok'; },
      res:{
        ok:[201,{status:'active',twoFactor:true}],
        duplicate:[409,{error:'business_exists'}],
        badcode:[401,{error:'invalid_code'}],
        pdf:[201,{status:'generated',document:'{id}.pdf'}],
        analytics:[202,{status:'dashboard_updated',realtime:true}]
      },
      title:'Secure accounts, generate documents and update admin analytics',
      blurb:'The BlockTremp systems I built: duplicate-business protection, phone verification and 2FA, a PDF microservice for document generation, and admin analytics with real-time subscription updates.',
      scenarios:[
        ['auto','From inputs'],
        ['ok','Registers'],
        ['duplicate','Duplicate business'],
        ['badcode','Wrong phone code'],
        ['pdf','Generate PDF'],
        ['analytics','Live analytics']
      ],
      fields:[
        {id:'biz',key:'name',label:'Business name',type:'text',value:'Abuja Grain Traders'},
        {id:'code',label:'Phone code',type:'text',value:'482913'},
        {id:'docbt',label:'Document',type:'select',options:['Invoice','Subscription statement','Account summary'],value:'Invoice'},
        {id:'eventbt',label:'Subscription event',type:'select',options:['Plan upgraded','Subscription renewed','Subscription cancelled'],value:'Plan upgraded'}
      ],
      stages:[
        ['Request','POST /businesses, payload validated'],
        ['Duplicate check','Block a second account for the same business'],
        ['Phone verification','One-time code sent and checked'],
        ['Two-factor setup','Second factor enrolled for the admin login'],
        ['Analytics update','Admin dashboard updated in real time']
      ],
      run: async function(h){
        function relabel(items){
          items.forEach(function(item,i){
            if(!nodes[i]) return;
            nodes[i].querySelector('h3').textContent=item[0];
            nodes[i].querySelector('p').textContent=item[1];
          });
        }

        if(h.s==='pdf'){
          var doc=h.v('docbt')||'Invoice', file='DOC-'+h.rid(6).toUpperCase()+'.pdf';
          relabel([
            ['Document request','Document generation request received'],
            ['Template and data','Load the template and assemble document data'],
            ['PDF microservice','Render the document in the PDF service'],
            ['Store document','Persist the generated file and metadata'],
            ['Event and audit','Emit completion and record the generation event']
          ]);

          h.go(0); h.log('api','Generate '+doc.toLowerCase()+' document'); await h.sleep(420);
          h.log('api','Document request validated'); h.pass(0); await h.sleep(280);

          h.go(1); h.log('document','Loading '+doc+' template'); await h.sleep(420);
          h.log('document','Template data assembled','ok'); h.pass(1); await h.sleep(280);

          h.go(2); h.log('pdf','Rendering document in PDF microservice'); await h.sleep(620);
          h.log('pdf',file+' generated','ok'); h.pass(2); await h.sleep(300);

          h.go(3); h.log('storage','Saving '+file+' and document metadata'); await h.sleep(460);
          h.log('storage','Document stored successfully','ok'); h.pass(3); await h.sleep(280);

          h.go(4); h.log('events','document.generated emitted'); await h.sleep(350);
          h.log('audit','Generation recorded for '+file,'ok'); h.pass(4);
          return h.end('ok',doc+' generated successfully.');
        }

        if(h.s==='analytics'){
          var evt=h.v('eventbt')||'Plan upgraded';
          relabel([
            ['Subscription event','Receive a subscription lifecycle event'],
            ['Validate state','Check the subscription and account state'],
            ['Update metrics','Recalculate the affected admin metrics'],
            ['Real-time update','Push the changed subscription state'],
            ['Dashboard refresh','Admin analytics reflects the new values']
          ]);

          h.go(0); h.log('subscription',evt+' received'); await h.sleep(420);
          h.log('events','Subscription event accepted'); h.pass(0); await h.sleep(280);

          h.go(1); h.log('subscription','Validating account and subscription state'); await h.sleep(480);
          h.log('subscription','State is consistent','ok'); h.pass(1); await h.sleep(280);

          h.go(2); h.log('analytics','Recalculating active subscription metrics'); await h.sleep(520);
          h.log('analytics','Admin metrics updated','ok'); h.pass(2); await h.sleep(280);

          h.go(3); h.log('realtime','Publishing subscription update to the admin dashboard'); await h.sleep(500);
          h.log('realtime','Update delivered','ok'); h.pass(3); await h.sleep(280);

          h.go(4); h.log('dashboard','Dashboard refreshed with '+evt.toLowerCase()); await h.sleep(400);
          h.log('dashboard','Live subscription analytics are current','ok'); h.pass(4);
          return h.end('ok','Admin analytics updated in real time.');
        }

        relabel([
          ['Request','POST /businesses, payload validated'],
          ['Duplicate check','Block a second account for the same business'],
          ['Phone verification','One-time code sent and checked'],
          ['Two-factor setup','Second factor enrolled for the admin login'],
          ['Analytics update','Admin dashboard updated in real time']
        ]);

        var biz=h.v('biz')||'Lagos Fresh Foods Ltd';
        h.go(0); h.log('api','POST /businesses "'+biz+'"'); await h.sleep(450);
        h.log('api','Payload validated'); h.pass(0); await h.sleep(350);

        h.go(1); h.log('accounts','Checking for an existing business account'); await h.sleep(600);
        if(h.s==='duplicate'){
          h.log('accounts','This business is already registered. Blocked','bad'); h.set(1,'fail','blocked'); await h.sleep(350);
          h.skip([2,3,4]); return h.end('bad','Registration blocked. No duplicate account was created.');
        }
        h.log('accounts','No existing account found','ok'); h.pass(1); await h.sleep(350);

        h.go(2); h.log('verify','One-time code sent to the owner phone'); await h.sleep(650);
        if(h.s==='badcode'){
          h.log('verify','Code did not match','bad'); h.set(2,'fail','failed'); await h.sleep(350);
          h.skip([3,4]); return h.end('bad','Phone not verified. The account stays locked until the code matches.');
        }
        h.log('verify','Phone number verified','ok'); h.pass(2); await h.sleep(350);

        h.go(3); h.log('2fa','Second-factor secret generated'); await h.sleep(500);
        h.log('2fa','Second factor confirmed','ok'); h.pass(3); await h.sleep(350);

        h.go(4); h.log('analytics','Account added to admin analytics'); await h.sleep(450);
        h.log('events','Subscription update pushed to the dashboard live','ok'); h.pass(4);
        return h.end('ok','Registered and secured. The admin dashboard updated live.');
      } },

    { id:'gemspread', label:'Gemspread', kind:'Backend', btn:'Upload files', path:'POST /uploads',
      hint:'Rules: a guest is denied. A flaky network makes one upload fail.',
      auto:function(v){ if(v('role')==='guest') return 'forbidden'; if(v('net')==='Flaky') return 'onefail'; return 'ok'; },
      res:{ok:[201,{status:'uploaded'}],onefail:[207,{status:'partial',failed:1}],forbidden:[403,{error:'forbidden'}]},
      title:'Upload a batch of files in parallel',
      blurb:'The upload service I built at Gemspread on Cloudinary: guarded access, bulk uploads processed in parallel, and automatic cleanup.',
      scenarios:[['auto','From inputs'],['ok','All succeed'],['onefail','One fails'],['forbidden','No permission']],
      fields:[{id:'files',label:'Files',type:'select',options:['3','5','10'],value:'5'},{id:'role',label:'Role',type:'select',options:['editor','guest']},{id:'net',label:'Network',type:'select',options:['Stable','Flaky']}],
      stages:[['Request','POST /uploads with a batch of files'],['Auth and RBAC','JWT check, then role guard'],['Validate','Type and size checked per file'],['Parallel upload','Files sent to Cloudinary at the same time'],['Save and clean up','Records saved, temporary files removed']],
      run: async function(h){
        var n=parseInt(h.v('files'),10)||5;
        h.go(0); h.log('api','POST /uploads with '+n+' files'); await h.sleep(450);
        h.log('api','Request received'); h.pass(0); await h.sleep(300);
        h.go(1); h.log('auth','JWT verified, role: '+(h.s==='forbidden'?'guest':'editor')); await h.sleep(450);
        if(h.s==='forbidden'){
          h.log('auth','RBAC guard: role "guest" cannot upload files','bad'); h.set(1,'fail','denied 403'); await h.sleep(350);
          h.skip([2,3,4]); return h.end('bad','Rejected with 403. Nothing was uploaded.');
        }
        h.log('auth','Guard passed','ok'); h.pass(1); await h.sleep(300);
        h.go(2); h.log('files','Checking type and size for '+n+' files'); await h.sleep(500);
        h.log('files','All files accepted','ok'); h.pass(2); await h.sleep(300);
        h.go(3); h.log('cloudinary','Uploading '+n+' files in parallel'); await h.sleep(400);
        var order=[]; for(var i=1;i<=n;i++) order.push(i);
        order.sort(function(){ return Math.random()-.5; });
        var bad=h.s==='onefail'?pick(order):-1, saved=0;
        for(var k=0;k<order.length;k++){
          await h.sleep(170);
          if(order[k]===bad) h.log('cloudinary','file '+order[k]+' failed: upstream timeout','bad');
          else { saved++; h.log('cloudinary','file '+order[k]+' uploaded','ok'); }
        }
        if(bad>0) h.set(3,'warn','1 failed'); else h.pass(3);
        await h.sleep(350);
        h.go(4); h.log('db','Saved records for '+saved+' of '+n+' files'); await h.sleep(400);
        h.log('cleanup','Temporary files removed automatically','ok'); h.pass(4);
        return bad>0 ? h.end('warn',saved+' of '+n+' files saved. The failed file was reported and temp files were cleaned up.') : h.end('ok','All '+n+' files uploaded and cleaned up.');
      } },

    { id:'agroshop', label:'AgroShop', kind:'Backend', btn:'Place order', path:'POST /orders',
      hint:'Rules: the OTP sent is 552019. The contract accepts up to 20 units per order.',
      auto:function(v){ if(v('otp').trim()!=='552019') return 'badotp'; if(parseInt(v('qty'),10)>20) return 'rejected'; return 'ok'; },
      res:{ok:[201,{status:'paid',id:'{id}'}],badotp:[401,{error:'invalid_otp'}],rejected:[402,{status:'failed',reason:'contract_rejected'}]},
      title:'Buy produce through a smart contract',
      blurb:'The marketplace flow at AgroShop: OTP login, cart and order in PostgreSQL, then an Algorand smart contract for the purchase.',
      scenarios:[['auto','From inputs'],['ok','Purchase succeeds'],['badotp','Wrong OTP'],['rejected','Contract rejects']],
      fields:[{id:'item',label:'Item',type:'select',options:['Maize','Yam','Tomatoes']},{id:'qty',key:'quantity',label:'Quantity',type:'number',value:3},{id:'otp',label:'OTP',type:'text',value:'552019'}],
      stages:[['OTP login','One-time code sent by email and checked'],['Cart and order','Order created in PostgreSQL'],['Smart contract','Algorand purchase contract called'],['Order status','Order updated from the chain result'],['Notification','Buyer notified of the outcome']],
      run: async function(h){
        var item=h.v('item'), qty=Math.max(1,parseInt(h.v('qty'),10)||1), ord='ord_'+h.rid(5);
        h.go(0); h.log('auth','OTP sent by email'); await h.sleep(600);
        if(h.s==='badotp'){
          h.log('auth','OTP did not match','bad'); h.set(0,'fail','refused'); await h.sleep(350);
          h.skip([1,2,3,4]); return h.end('bad','Login refused. No order was created.');
        }
        h.log('auth','OTP verified','ok'); h.pass(0); await h.sleep(350);
        h.go(1); h.log('cart','Added '+qty+' x '+item+' to the cart'); await h.sleep(450);
        h.log('orders',ord+' created, status: pending'); h.pass(1); await h.sleep(350);
        h.go(2); h.log('algorand','Calling the purchase contract for '+ord); await h.sleep(750);
        if(h.s==='rejected'){
          h.log('algorand','Contract rejected the transaction','bad'); h.set(2,'fail','rejected'); await h.sleep(350);
          h.go(3); h.log('orders',ord+' marked failed, cart kept','warn'); await h.sleep(400); h.set(3,'warn','failed'); await h.sleep(300);
          h.go(4); h.log('notify','Failure notification created for the buyer'); await h.sleep(400); h.pass(4,'sent');
          return h.end('warn','Purchase failed on-chain. The order is marked failed and the buyer was told.');
        }
        h.log('algorand','Transaction confirmed, tx '+h.rid(10).toUpperCase(),'ok'); h.pass(2); await h.sleep(350);
        h.go(3); h.log('orders',ord+' status: paid','ok'); await h.sleep(400); h.pass(3); await h.sleep(300);
        h.go(4); h.log('notify','Order confirmation created for the buyer'); await h.sleep(400); h.pass(4,'sent');
        return h.end('ok','Order paid and confirmed on-chain.');
      } },

    { id:'gopaddi', label:'Gopaddi', kind:'Android', btn:'Book with PaddiAI',
      hint:'Rules: turn push off to see it suppressed, or change the date to see the booking update.',
      auto:function(v){ if(v('push')==='Off') return 'muted'; if(v('chg')==='Change date') return 'modify'; return 'book'; },
      screens:[
        {title:'PaddiAI', caption:'Your assistant for quick bookings', cards:[{text:'You: {prompt}', tone:'soft'},{text:'Best match: {vert}', tone:'dark'},{text:'Ready to show options', tone:'ok'}], button:'Send'},
        {title:'PaddiAI', caption:'Options have been matched to the request', cards:[{text:'Looking for {vert}', tone:'soft'},{text:'3 options found', tone:'dark'},{text:'Option 1 recommended', tone:'ok'}], button:'Pick option 1'},
        {title:'Confirm booking', caption:'A booking has been prepared', cards:[{text:'{vert}', tone:'soft'},{text:'Status: confirmed', tone:'ok'},{text:'Payment can happen later', tone:'dark'}], button:'Confirm'},
        {title:'Active Center', caption:'The booking can now be managed', cards:[{text:'{vert} booking', tone:'soft'},{text:'Modify or pay', tone:'dark'},{text:'Booking is active', tone:'ok'}], button:'Open booking'},
        {title:'Notifications', cards:[{text:'Booking update', tone:'soft'},{text:'Sent through FCM', tone:'soft'}], button:'Open'}
      ],
      title:'Book with the PaddiAI assistant',
      blurb:'The booking experience in the Gopaddi app: an AI assistant that books across verticals, an Active Center to manage bookings, and push notifications that respect user preferences.',
      scenarios:[['auto','From inputs'],['book','Book'],['modify','Modify booking'],['muted','Push muted']],
      fields:[{id:'vert',label:'Vertical',type:'select',options:['Hotel','Restaurant','Vacation rental','Package']},{id:'prompt',label:'Ask PaddiAI',type:'text',value:'Something nice for two this weekend'},{id:'push',label:'Push notifications',type:'select',options:['On','Off']},{id:'chg',label:'Booking',type:'select',options:['Keep date','Change date']}],
      stages:[['Prompt','User asks the assistant in plain language'],['Match vertical','Intent mapped to a booking vertical'],['Create booking','Booking created through the API'],['Active Center','Booking listed with modify and pay options'],['Push notification','FCM push, if the user allows it']],
      run: async function(h){
        var vert=h.v('vert'), v=vert.toLowerCase(), prompt=h.v('prompt')||'Something nice for two this weekend', bk='bk_'+h.rid(5);
        h.go(0); h.log('app','PaddiAI prompt: "'+prompt+'"'); await h.sleep(500);
        h.log('api','POST /assistant/message'); h.pass(0); await h.sleep(350);
        h.go(1); h.log('assistant','Intent matched to '+v); await h.sleep(550);
        h.log('search','Fetched '+v+' options, shown in the chat','ok'); h.pass(1); await h.sleep(350);
        h.go(2); h.log('booking',bk+' created for '+v); await h.sleep(500);
        h.log('booking','Status: confirmed','ok'); h.pass(2); await h.sleep(350);
        h.go(3); h.log('active','Booking added to the Active Center'); await h.sleep(500);
        if(h.s==='modify'){
          h.log('active','User changes the date','warn'); await h.sleep(500);
          h.log('booking',bk+' updated, payment amount recalculated','ok');
        } else {
          h.log('active','Modify and pay options ready','ok');
        }
        h.pass(3); await h.sleep(350);
        h.go(4);
        if(h.s==='muted'){
          h.log('push','User turned off booking updates. Push suppressed','warn'); await h.sleep(450);
          h.log('app','In-app notification still saved','ok'); h.pass(4,'suppressed');
          return h.end('ok','No push sent, because the user opted out. The in-app entry is there.');
        }
        h.log('push',h.s==='modify'?'FCM push sent: booking updated':'FCM push sent: booking confirmed','ok'); h.pass(4,'sent');
        return h.end('ok',h.s==='modify'?'Booking updated. Push notification delivered.':'Booking confirmed. Push notification delivered.');
      } },

    { id:'simpliride', label:'Simpliride', kind:'Android', btn:'Sign up and ride',
      hint:'Rules: a phone number needs a plus and 10 to 15 digits. The fare is 3,500 credits.',
      auto:function(v){ if(!/^\+\d{10,15}$/.test(v('phone').replace(/[\s-]/g,''))) return 'badphone'; if(parseFloat(v('credits'))<3500) return 'lowcredit'; return 'ok'; },
      screens:[
        {title:'Referral', caption:'A deep link opens the app', cards:[{text:'Invite code {ref}', tone:'soft'},{text:'Referral saved for signup', tone:'ok'}], button:'Get started'},
        {title:'Welcome', caption:'Onboarding must be completed first', cards:[{text:'Accept the service agreement', tone:'dark'},{text:'Phone: {phone}', tone:'soft'}], button:'Continue'},
        {title:'Book a ride', caption:'Pickup, drop-off and promo are ready', cards:[{text:'Pickup and drop-off', tone:'soft'},{text:'Promo {promo}', tone:'ok'}], button:'Request ride'},
        {title:'Ride in progress', caption:'The trip stays synced in the foreground', cards:[{text:'Timer running', tone:'dark'},{text:'Foreground service on', tone:'soft'},{text:'Ride status synced', tone:'ok'}], button:'End ride'},
        {title:'Payment', caption:'The app decides how the fare is covered', cards:[{text:'Pay with credits', tone:'soft'},{text:'Top up with Paystack', tone:'dark'},{text:'Fare: 3,500 credits', tone:'ok'}], button:'Pay'}
      ],
      title:'Sign up from a referral and take a ride',
      blurb:'The rider journey at Simpliride: a deep-link referral, onboarding with SLA acknowledgment and phone validation, a synced ride timer, and credit or Paystack payment.',
      scenarios:[['auto','From inputs'],['ok','Referral signup'],['badphone','Bad phone number'],['lowcredit','Low credits']],
      fields:[{id:'ref',label:'Referral code',type:'text',value:'AR-4821'},{id:'promo',label:'Promo code',type:'text',value:'WELCOME'},{id:'phone',label:'Phone',type:'text',value:'+234 803 123 4567'},{id:'credits',label:'Credits',type:'number',value:5000}],
      stages:[['Deep link','Referral link opened and the code captured'],['Onboarding','SLA accepted, phone number validated'],['Book ride','Pickup geocoded, promo applied'],['Ride in progress','Foreground service keeps the timer in sync'],['Payment','Credits used, Paystack for top-ups']],
      run: async function(h){
        var ref=h.v('ref')||'AR-4821', promo=h.v('promo')||'WELCOME';
        h.go(0); h.log('link','Opened link with ref='+ref); await h.sleep(500);
        h.log('referral','Referral code stored for signup'); h.pass(0); await h.sleep(350);
        h.go(1); h.log('onboarding','SLA acknowledgment required'); await h.sleep(500);
        h.log('onboarding','SLA accepted','ok'); await h.sleep(350);
        if(h.s==='badphone'){
          h.log('phone',h.v('phone')+' fails libphonenumber validation','bad'); h.set(1,'fail','invalid number'); await h.sleep(350);
          h.skip([2,3,4]); return h.end('bad','Signup paused. The rider sees which number rule failed.');
        }
        h.log('phone',h.v('phone')+' is valid','ok'); await h.sleep(300);
        h.log('referral','Referral recorded against '+ref,'ok'); h.pass(1); await h.sleep(350);
        h.go(2); h.log('geo','Pickup and drop-off geocoded'); await h.sleep(550);
        h.log('promo','Promo '+promo+' applied to the fare','ok'); h.pass(2); await h.sleep(350);
        h.go(3); h.log('service','Foreground service started'); await h.sleep(450);
        h.log('timer','Ride timer synced with the server'); await h.sleep(600);
        h.log('ride','Ride completed','ok'); h.pass(3); await h.sleep(350);
        h.go(4);
        if(h.s==='lowcredit'){
          h.log('credits','Balance is below the fare','warn'); await h.sleep(450);
          h.log('paystack','Checkout opened for a top-up'); await h.sleep(650);
          h.log('paystack','Payment verified, credits added','ok'); await h.sleep(350);
          h.log('credits','Fare deducted from credits','ok'); h.pass(4,'passed after top-up');
          return h.end('ok','Ride paid after a Paystack top-up.');
        }
        h.log('credits','Fare deducted from credits','ok'); h.pass(4);
        return h.end('ok','Ride paid from credits.');
      } },

    { id:'gopaddi-payouts', label:'Gopaddi payouts', case:'Gopaddi', kind:'Android', btn:'Verify and set up payouts',
      title:'Verify identity and set up payouts',
      blurb:'The host onboarding at Gopaddi: VerifyMe identity verification with document upload and status tracking, then bank details that adapt to the region for multi-currency payouts.',
      scenarios:[['auto','From inputs'],['ok','Verified'],['rejected','Document rejected'],['pending','Slow review']],
      fields:[{id:'region',label:'Region',type:'select',options:['Nigeria','United Kingdom','United States']},{id:'doc',label:'Document',type:'select',options:['Passport','National ID','Driver licence']},{id:'photo',label:'Photo',type:'select',options:['Clear','Blurry']}],
      hint:'Rules: a blurry photo is rejected. The bank fields and payout currency change with the region.',
      auto:function(v){ return v('photo')==='Blurry' ? 'rejected' : 'ok'; },
      screens:[['Verify identity',['Document: {doc}'],'Start'],['Upload document',['{doc} photo'],'Upload'],['Verification',['Status shown to the user'],'Refresh'],['Bank details',['Region: {region}','Fields adapt to the region'],'Save'],['Payouts',['Account saved'],'Done']],
      stages:[['Start','Identity verification opened with VerifyMe'],['Upload document','Document photo uploaded'],['Status tracking','Pending, then verified or rejected'],['Bank details','Form fields adapt to the region'],['Payout ready','Account saved for multi-currency payouts']],
      run: async function(h){
        var reg=h.v('region'), doc=h.v('doc');
        var map={'Nigeria':['NGN','bank name and account number'],'United Kingdom':['GBP','sort code and account number'],'United States':['USD','routing number and account number']}, m=map[reg]||map.Nigeria;
        h.go(0); h.log('verifyme','Starting identity verification'); await h.sleep(500);
        h.log('app','Document type: '+doc); h.pass(0); await h.sleep(350);
        h.go(1); h.log('upload','Uploading '+doc+' photo'); await h.sleep(650);
        h.log('upload','Upload complete','ok'); h.pass(1); await h.sleep(350);
        h.go(2); h.log('status','Status: pending'); await h.sleep(700);
        if(h.s==='rejected'){
          h.log('status','Status: rejected, photo not readable','bad'); h.set(2,'fail','rejected'); await h.sleep(350);
          h.skip([3,4]); return h.end('bad','Verification rejected. The user is asked to upload a clearer photo.');
        }
        if(h.s==='pending'){ h.log('status','Still pending, status shown to the user','warn'); await h.sleep(800); }
        h.log('status','Status: verified','ok'); h.pass(2); await h.sleep(350);
        h.go(3); h.log('payout','Region '+reg+': asking for '+m[1]); await h.sleep(600);
        h.log('payout','Fields validated','ok'); h.pass(3); await h.sleep(350);
        h.go(4); h.log('payout','Payout account saved in '+m[0]); await h.sleep(500); h.pass(4);
        return h.end('ok','Payout account saved and activated in '+m[0]+'.');
      } }
  ];

  var phone=$('#phone'), resEl=$('#res'), curScn='', curId='', gate=null, gated=false;
  var fv=function(f){ var el=document.getElementById('f-'+f); return el?el.value:''; };
  var tpl=function(t){ return t.replace(/\{(\w+)\}/g,function(_,k){ return fv(k); }); };
  function toast(kind,text){ var t=$('#ph-toast'); t.className='ph-toast '+kind; t.textContent=text||''; }
  function blankPhone(){ var s=sims[current]; $('#ph-title').textContent=s.label+' app'; $('#ph-lines').innerHTML=''; $('#ph-btn').textContent=''; toast('',''); }
  function showGopaddiScreen(i){
    var L=$('#ph-lines'), vert=fv('vert')||'Hotel', prompt=fv('prompt')||'Something nice for two this weekend';
    $('#ph-title').textContent = ['PaddiAI','Discover','Confirm booking','Active Center','Notifications'][i] || 'Gopaddi';
    $('#ph-btn').textContent = ['Send','Choose option','Confirm','Manage booking','Open'][i] || '';
    toast('','');
    if(i===0){
      L.innerHTML='<div class="mobile-ui"><div class="mobile-top"><span class="mobile-brand">Gopaddi</span><span class="mobile-avatar"></span></div><div class="mobile-search">'+tpl(prompt)+'</div><div class="mobile-chips"><span>Hotel</span><span>Restaurant</span><span>Package</span></div><div class="mobile-card soft"><h5>PaddiAI</h5><p>Finding the best '+vert.toLowerCase()+' options for your request…</p></div><div class="mobile-bottomnav"><span class="active">Home</span><span>Explore</span><span>Trips</span><span>Profile</span></div></div>';
    } else if(i===1){
      L.innerHTML='<div class="mobile-ui"><div class="mobile-top"><span class="mobile-brand">Discover '+vert+'</span><span class="mobile-avatar"></span></div><div class="mobile-hero"><small>Recommended for you</small><b>Top '+vert.toLowerCase()+' picks this weekend</b></div><div class="mobile-list"><div class="mobile-option"><span class="mobile-thumb"></span><span><b>Option 1</b><small>Best match</small></span><em>View</em></div><div class="mobile-option"><span class="mobile-thumb"></span><span><b>Option 2</b><small>Popular choice</small></span><em>View</em></div></div><div class="mobile-bottomnav"><span>Home</span><span class="active">Explore</span><span>Trips</span><span>Profile</span></div></div>';
    } else if(i===2){
      L.innerHTML='<div class="mobile-ui"><div class="mobile-card"><h5>'+vert+' booking</h5><p>Your selected option is ready to confirm.</p></div><div class="mobile-card success"><h5>Confirmed</h5><p>Booking created successfully.</p></div><div class="mobile-row"><small>Guests</small><strong>2</strong></div><div class="mobile-row"><small>Status</small><span class="mobile-status">Confirmed</span></div><div class="mobile-bottomnav"><span>Home</span><span>Explore</span><span class="active">Trips</span><span>Profile</span></div></div>';
    } else if(i===3){
      L.innerHTML='<div class="mobile-ui"><div class="mobile-top"><span class="mobile-brand">Active Center</span><span class="mobile-avatar"></span></div><div class="mobile-card"><h5>'+vert+' booking</h5><p>Upcoming · confirmed</p></div><div class="mobile-card soft"><h5>Manage booking</h5><p>Change date, view details or continue to payment.</p></div><div class="mobile-row"><button class="ph-btn" style="margin:0;flex:1">Modify</button><button class="ph-btn" style="margin:0;flex:1">Pay</button></div><div class="mobile-bottomnav"><span>Home</span><span>Explore</span><span class="active">Trips</span><span>Profile</span></div></div>';
    } else {
      $('#ph-btn').textContent = '';
      L.innerHTML='<div class="mobile-ui"><div class="mobile-top"><span class="mobile-brand">Notifications</span><span class="mobile-avatar"></span></div><div class="mobile-card soft"><h5>Booking update</h5><p>Your '+vert.toLowerCase()+' booking is confirmed.</p></div><div class="mobile-card"><h5>Sent through FCM</h5><p>Push notification delivered successfully.</p></div><div class="ph-btn ph-btn-inline">Open</div><div class="mobile-bottomnav"><span>Home</span><span>Explore</span><span>Trips</span><span class="active">Profile</span></div></div>';
    }
  }

  function showSimplirideScreen(i){
    var L=$('#ph-lines'), promo=fv('promo')||'WELCOME', phoneVal=fv('phone')||'+234 803 123 4567';
    $('#ph-title').textContent = ['Referral','Welcome','Book a ride','Ride in progress','Payment'][i] || 'Simpliride';
    $('#ph-btn').textContent = ['Get started','Continue','Request ride','End ride','Pay'][i] || '';
    toast('','');
    if(i===0){
      L.innerHTML='<div class="ride-ui"><div class="mobile-top"><span class="mobile-brand">Simpliride</span><span class="mobile-avatar"></span></div><div class="mobile-card soft"><h5>Referral detected</h5><p>Invite code '+tpl(fv('ref')||'AR-4821')+' was captured from the deep link.</p></div><div class="mobile-card success"><h5>Ready to sign up</h5><p>Your referral will be attached to the new account.</p></div></div>';
    } else if(i===1){
      L.innerHTML='<div class="ride-ui"><div class="mobile-top"><span class="mobile-brand">Welcome</span><span class="mobile-avatar"></span></div><div class="mobile-card"><h5>Service agreement</h5><p>Review and accept before requesting a ride.</p></div><div class="mobile-card soft"><h5>Phone</h5><p>'+phoneVal+'</p></div><div class="mobile-card success"><h5>Verified</h5><p>Phone number format accepted.</p></div></div>';
    } else if(i===2){
      L.innerHTML='<div class="ride-ui"><div class="ride-points"><div class="ride-point"><i></i><span>Current location</span></div><div class="ride-point dest"><i></i><span>Lekki Phase 1</span></div></div><div class="ride-map"><span class="route-line"></span><span class="ride-car">🚗</span><span class="eta-bubble">5 min away</span></div><div class="fare-card"><span>Promo '+promo+'</span><b>₦3,500</b></div></div>';
    } else if(i===3){
      L.innerHTML='<div class="ride-ui"><div class="ride-map"><span class="route-line"></span><span class="ride-car">🚙</span><span class="eta-bubble">Trip active</span></div><div class="driver-card"><span class="driver-avatar"></span><span><b>Driver · Toyota Corolla</b><small>4.9 ★ · synced ride timer</small></span><strong>•••</strong></div><div class="mobile-status">Foreground service active</div></div>';
    } else {
      L.innerHTML='<div class="ride-ui"><div class="wallet-card"><small>Credit balance</small><strong>'+((parseFloat(fv('credits'))||5000).toLocaleString())+'</strong><p>Fare: 3,500 credits</p></div><div class="payment-options"><div class="payment-option active"><span>Pay with credits</span><strong>Selected</strong></div><div class="payment-option"><span>Top up with Paystack</span><strong>→</strong></div></div><div class="mobile-card success"><h5>Payment ready</h5><p>The fare can be settled from credits or after a top-up.</p></div></div>';
    }
  }

  function showGopaddiPayoutScreen(i){
    var L=$('#ph-lines'), reg=fv('region')||'Nigeria', doc=fv('doc')||'Passport';
    var map={
      'Nigeria':['NGN','Bank name','Account number'],
      'United Kingdom':['GBP','Sort code','Account number'],
      'United States':['USD','Routing number','Account number']
    }, m=map[reg]||map.Nigeria;

    $('#ph-title').textContent=['Verify identity','Upload document','Verification','Bank details','Payouts'][i]||'Payouts';
    $('#ph-btn').textContent=['Start verification','Upload','Refresh status','Save details','Done'][i]||'';
    toast('','');

    if(i===0){
      L.innerHTML='<div class="verify-shell"><div class="verify-hero"><div class="verify-head"><span class="verify-icon">✓</span><span><b>VerifyMe identity check</b><small>Secure host verification</small></span></div><div class="mobile-card soft"><h5>'+doc+'</h5><p>Selected document for identity verification.</p></div></div><div class="verify-timeline"><div class="verify-step active"><i>1</i><span>Identity</span><small>Ready</small></div><div class="verify-step"><i>2</i><span>Document</span><small>Next</small></div><div class="verify-step"><i>3</i><span>Bank details</span><small>Later</small></div></div></div>';
    } else if(i===1){
      L.innerHTML='<div class="verify-shell"><div class="doc-preview"><span class="doc-photo"></span><span class="doc-lines"><i></i><i></i><i></i></span></div><div class="mobile-row"><small>'+doc+'</small><strong>Uploading…</strong></div><div class="upload-progress"><span style="width:78%"></span></div><div class="mobile-card soft"><h5>Document captured</h5><p>Photo quality and document type are being checked.</p></div></div>';
    } else if(i===2){
      L.innerHTML='<div class="verify-shell"><div class="verify-hero"><div class="verify-head"><span class="verify-icon">✓</span><span><b>Verification status</b><small>VerifyMe</small></span></div></div><div class="verify-timeline"><div class="verify-step done"><i>✓</i><span>Document uploaded</span><small>Done</small></div><div class="verify-step active"><i>2</i><span>Identity review</span><small>Checking</small></div><div class="verify-step"><i>3</i><span>Result</span><small>Pending</small></div></div><div class="mobile-card success"><h5>Identity verified</h5><p>You can continue to payout setup.</p></div></div>';
    } else if(i===3){
      L.innerHTML='<div class="verify-shell"><div class="mobile-row"><span class="currency-badge">'+m[0]+'</span><small>'+reg+'</small></div><div class="bank-form"><div class="bank-field"><label>'+m[1]+'</label><b>Example value</b></div><div class="bank-field"><label>'+m[2]+'</label><b>•••• 4821</b></div><div class="bank-field"><label>Account name</label><b>Arthur Okolo</b></div></div><div class="mobile-card soft"><h5>Region-aware form</h5><p>Fields adapt automatically for '+reg+'.</p></div></div>';
    } else {
      L.innerHTML='<div class="verify-shell"><div class="payout-success"><span class="check">✓</span><b>Payouts ready</b><small>Verified and configured in '+m[0]+'.</small></div><div class="payout-account"><div class="mobile-row"><small>Region</small><strong>'+reg+'</strong></div><div class="mobile-row"><small>Currency</small><strong>'+m[0]+'</strong></div><div class="mobile-row"><small>Status</small><span class="mobile-status">Active</span></div></div></div>';
    }
  }

  function showScreen(i){
    var s=sims[current];
    if(s.id==='gopaddi'){ showGopaddiScreen(i); return; }
    if(s.id==='simpliride'){ showSimplirideScreen(i); return; }
    if(s.id==='gopaddi-payouts'){ showGopaddiPayoutScreen(i); return; }

    var sc=s.screens[i], L=$('#ph-lines'); L.innerHTML='';
    if(Array.isArray(sc)){
      $('#ph-title').textContent=sc[0];
      sc[1].forEach(function(x){ var d=document.createElement('div'); d.className='ph-line'; d.textContent=tpl(x); L.appendChild(d); });
      $('#ph-btn').textContent=sc[2];
      toast('','');
      return;
    }
    $('#ph-title').textContent=tpl(sc.title || '');
    if(sc.caption){
      var c=document.createElement('div');
      c.className='ph-caption';
      c.textContent=tpl(sc.caption);
      L.appendChild(c);
    }
    (sc.cards || []).forEach(function(card){
      var d=document.createElement('div');
      d.className='ph-card ' + (card.tone || 'soft') + (card.small ? ' small' : '');
      d.textContent=tpl(card.text || '');
      L.appendChild(d);
    });
    $('#ph-btn').textContent=tpl(sc.button || '');
    toast(sc.toastKind || '', sc.toast ? tpl(sc.toast) : '');
  }
  function setNode(i,state,text){
    var n=nodes[i]; if(!n) return;
    n.className='node '+state; n.querySelector('.state').textContent=text||'';
    if(sims[current].screens){ if(state==='active') showScreen(i); else if(state==='fail') toast('bad',text); else if(state==='warn') toast('warn',text); }
  }
  var STATUS={200:'OK',201:'Created',202:'Accepted',207:'Multi-Status',401:'Unauthorized',402:'Payment Required',403:'Forbidden',409:'Conflict'};
  function resLine(cls,t){ var d=document.createElement('div'); d.className=cls; d.textContent=t; resEl.appendChild(d); }
  function showReq(){
    var s=sims[current]; resEl.innerHTML=''; if(!s.res) return;
    var body={}; s.fields.forEach(function(f){ body[f.key||f.id]=f.type==='number'?Number(fv(f.id)):fv(f.id); });
    resLine('',s.path); resLine('',JSON.stringify(body));
  }
  function log(tag, msg, cls){
    clock += Math.round(20 + Math.random() * 140);
    var li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = '<time></time><span class="tag"></span><span class="msg"></span>';
    li.querySelector('time').textContent = '+' + (clock / 1000).toFixed(2) + 's';
    li.querySelector('.tag').textContent = tag;
    li.querySelector('.msg').textContent = msg;
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function end(kind, text){
    banner.className = 'banner ' + kind; banner.textContent = text;
    var s = sims[current];
    if (s.screens) {
      if (s.kind === 'Android' && kind === 'ok') toast('', '');
      else toast(kind, text);
    }
    if (s.res && s.res[curScn]) {
      var r = s.res[curScn], c = r[0];
      resLine('st ' + (c < 300 ? '' : c < 400 ? 'warn' : 'bad'), '\u2192 ' + c + ' ' + (STATUS[c] || ''));
      resLine('', JSON.stringify(r[1]).split('{id}').join(curId));
    }
  }

  var hasRunCurrentSim = false;

  var track = 'backend';
  function renderTabs(){
    tabsEl.innerHTML = '';
    if(projectPicker) projectPicker.innerHTML = '';
    var vis = sims.map(function(_, i){ return i; }).filter(function(i){ return sims[i].kind.toLowerCase() === track; });
    vis.forEach(function(i){
      var s = sims[i], b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.id = 'tab-' + s.id;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'panel');
      b.setAttribute('aria-selected', i === current ? 'true' : 'false');
      b.tabIndex = i === current ? 0 : -1;
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = s.label; b.lastChild.textContent = s.kind;
      b.addEventListener('click', function(){ select(i, false); });
      b.addEventListener('keydown', function(e){
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault(); select(vis[(vis.indexOf(i) + d + vis.length) % vis.length], true);
      });
      tabsEl.appendChild(b);
      if(projectPicker){
        var o=document.createElement('option');
        o.value=String(i); o.textContent=s.label;
        o.selected=i===current;
        projectPicker.appendChild(o);
      }
    });
    if(projectPicker){
      projectPicker.onchange=function(){
        select(parseInt(projectPicker.value,10), false);
      };
    }
  }

  function renderSim(){
    var s = sims[current];
    hasRunCurrentSim = false;
    $('#sim-name').textContent = s.title; $('#sim-blurb').textContent = s.blurb;
    $('#case-link').textContent = 'Read how I built this at ' + (s.case || s.label);
    $('#panel').setAttribute('aria-labelledby', 'tab-' + s.id);
    $('#panel').dataset.simId = s.id;
    $('#panel').classList.toggle('android-layout', s.kind === 'Android');
    setLabView('configure');
    setTabletView('build');
    setEventView('preview');
    var html = '<fieldset class="seg-field"><legend>Scenario</legend><div class="seg">';
    s.scenarios.forEach(function(sc, i){
      html += '<input type="radio" name="scn" id="sc-' + i + '" value="' + sc[0] + '"' + (i === 0 ? ' checked' : '') + '><label for="sc-' + i + '">' + sc[1] + '</label>';
    });
    html += '</div></fieldset>';
    s.fields.forEach(function(f){
      html += '<div class="field field-' + f.id + '"><label class="lbl" for="f-' + f.id + '">' + f.label + '</label>';
      if (f.type === 'select') {
        html += '<select id="f-' + f.id + '">' + f.options.map(function(o){ return '<option' + (o === f.value ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>';
      } else if (f.type === 'number') {
        html += '<input id="f-' + f.id + '" type="number" min="1" step="1" inputmode="decimal" value="' + f.value + '">';
      } else {
        html += '<input class="wide" id="f-' + f.id + '" type="text" value="' + f.value + '">';
      }
      html += '</div>';
    });
    html += '<button class="btn" id="run" type="button">' + s.btn + '</button><label class="stepl"><input type="checkbox" id="step"> Step through</label><button class="btn ghost" id="next" type="button" disabled>Next stage</button>';
    if (s.hint) html += '<p class="hint">' + s.hint + '</p>';
    controls.innerHTML = html;

    var controlsCol = controls.closest('.controls-column');
    if(controlsCol){
      var oldFooter = controlsCol.querySelector('.configure-footer');
      if(oldFooter) oldFooter.remove();

      var hint = controls.querySelector('.hint');
      if(hint){
        var footer = document.createElement('div');
        footer.className = 'configure-footer';
        var label = document.createElement('div');
        label.className = 'configure-footer-label';
        label.textContent = 'Simulation rules';
        footer.appendChild(label);
        footer.appendChild(hint);
        controlsCol.appendChild(footer);
      }
    }

    if(s.id==='blocktremp'){
      var updateBlockTrempFields=function(){
        var selected=document.querySelector('input[name=scn]:checked');
        var mode=selected ? selected.value : 'auto';
        var regFields=['.field-biz','.field-code'];
        var pdfFields=['.field-docbt'];
        var analyticsFields=['.field-eventbt'];

        regFields.concat(pdfFields,analyticsFields).forEach(function(sel){
          var el=$(sel); if(el) el.hidden=true;
        });

        var visible = mode==='pdf' ? pdfFields : mode==='analytics' ? analyticsFields : regFields;
        visible.forEach(function(sel){ var el=$(sel); if(el) el.hidden=false; });
      };
      Array.prototype.slice.call(controls.querySelectorAll('input[name=scn]')).forEach(function(r){
        r.addEventListener('change', updateBlockTrempFields);
      });
      updateBlockTrempFields();
    }

    pipe.innerHTML = s.stages.map(function(st, i){
      return '<li class="node idle"><span class="mark">' + (i + 1) + '</span><h3>' + st[0] + '</h3><span class="state"></span><p>' + st[1] + '</p></li>';
    }).join('');
    nodes = Array.prototype.slice.call(pipe.children);
    gate = null; gated = false;
    phone.hidden = !s.screens; resEl.hidden = !s.res; resEl.innerHTML = '';
    var eventTitle=$('#event-title'), eventHelp=$('#event-help');
    if(eventTitle && eventHelp){
      if(s.kind==='Android'){
        eventTitle.textContent='3. Live app events';
        eventHelp.textContent='App, API and integration events as the flow progresses.';
      } else {
        eventTitle.textContent='3. Live event log';
        eventHelp.textContent='Real-time events and response data.';
      }
    }
    if (s.screens) blankPhone();
    logEl.innerHTML = '<li class="empty">Run a scenario to see the event log.</li>';
    banner.className = 'banner'; banner.textContent = 'Pick a scenario and run it.';
  }

  async function run(){
    var id = ++runId, s = sims[current], btn = $('#run');
    var isRerun = hasRunCurrentSim;
    hasRunCurrentSim = true;

    if(isMobileLab()){
      setLabView('events');
      if(s.kind === 'Android'){
        setEventView('preview');
      }
    }

    if(isTabletLab()){
      setTabletView('observe');
      if(s.kind === 'Android'){
        setEventView('preview');
      }
    }

    btn.disabled = true; btn.textContent = 'Running';
    gate = null; gated = false; $('#next').disabled = true;
    logEl.innerHTML = ''; clock = 0;
    nodes.forEach(function(_, i){ setNode(i, 'idle', ''); });
    if (s.screens) blankPhone();
    var sc = document.querySelector('input[name=scn]:checked').value;
    if (sc === 'auto') sc = s.auto(fv);
    curScn = sc; curId = 'txn_' + rid(6);
    showReq();
    banner.className = 'banner'; banner.textContent = 'Running';
    var chk = function(){ if (id !== runId) throw CANCEL; };
    var h = {
      s: sc, v: fv,
      sleep: function(ms){
        var st = $('#step');
        if (gated && st && st.checked) {
          gated = false;
          return new Promise(function(r){ gate = r; var nb = $('#next'); if (nb) nb.disabled = false; }).then(chk);
        }
        return new Promise(function(r){ setTimeout(r, reduce ? 0 : ms); }).then(chk);
      },
      set: setNode, log: log, end: end, rid: rid,
      go: function(i){ gated = true; setNode(i, 'active', 'running'); },
      pass: function(i, t){ setNode(i, 'pass', t || 'passed'); },
      skip: function(list){ list.forEach(function(i){ setNode(i, 'skip', 'skipped'); }); }
    };
    try { await s.run(h); }
    catch (e) { if (e !== CANCEL) throw e; return; }
    finally {
      if (id === runId) {
        var b = $('#run'); if (b) { b.disabled = false; b.textContent = 'Run again'; }
        var nb = $('#next'); if (nb) nb.disabled = true; gate = null;
        if(s.kind === 'Android' && isRerun && (isMobileLab() || isTabletLab())){
          setEventView('preview');
        }

        var eventsBtn=document.querySelector('.lab-mobile-nav [data-lab-view="events"]');
        if(eventsBtn) eventsBtn.classList.add('has-events');
      }
    }
  }

  function select(i, focus){
    runId++;
    current = i;
    renderTabs(); renderSim();
    if (focus) document.getElementById('tab-' + sims[i].id).focus();

    /* Role/project switches never auto-run.
       Every viewport waits for an explicit Run. */
  }

  controls.addEventListener('click', function(e){
    if (e.target.id === 'run' && !e.target.disabled) run();
    if (e.target.id === 'next' && gate) { var g = gate; gate = null; e.target.disabled = true; g(); }
  });
  $('#case-link').addEventListener('click', function(e){
    e.preventDefault();
    var s = sims[current], t = null;
    Array.prototype.forEach.call(document.querySelectorAll('.case, .droid li'), function(el){ if (el.querySelector('h3').textContent.indexOf(s.case || s.label) === 0) t = el; });
    if (!t) return;
    if (t.tagName === 'DETAILS') t.open = true;
    t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    t.classList.add('flash'); setTimeout(function(){ t.classList.remove('flash'); }, 1600);
  });

  var copy = {
    backend:{ h1:'I build backend systems products depend on.',
      sub:'Backend engineer in Lagos with 3.7 years of production experience across payments, authentication, RBAC, compliance, background jobs, admin systems and production APIs in NestJS, TypeScript and PostgreSQL.',
      years:'3.7 years', yearsSub:'Backend production experience',
      cta:'See production work', href:'#work', workH:'Backend work', andH:'Android work', contact:'Open to backend engineering roles' },
    android:{ h1:'I build Android products people depend on.',
      sub:'Android engineer in Lagos with 2 years of production experience building booking, search, notifications, onboarding, payments, identity verification and ride-hailing flows in Kotlin and Jetpack Compose.',
      years:'2 years', yearsSub:'Android production experience',
      cta:'See Android work', href:'#android', workH:'Backend work', andH:'Android work', contact:'Open to Android engineering roles' }
  };
  var stackEl = document.querySelector('#stack dl'), backendStack = stackEl.innerHTML;
  var androidStack = '<div><dt>Languages and UI</dt><dd>Kotlin, Java, Jetpack Compose, XML, Material Design</dd></div>' +
    '<div><dt>Architecture</dt><dd>MVVM, ViewModel, Dagger-Hilt, Coroutines, Flow</dd></div>' +
    '<div><dt>Data and network</dt><dd>Room, DataStore, Retrofit, OkHttp, Firebase, FCM push</dd></div>' +
    '<div><dt>Integrations</dt><dd>Paystack, VerifyMe identity verification, AdMob, deep links, AI-powered booking features</dd></div>' +
    '<div><dt>Testing</dt><dd>Espresso, unit tests, code reviews</dd></div>' +
    '<div><dt>Daily AI tools</dt><dd>Claude Code, Codex, Copilot, Cursor</dd></div>';
  function applyTrack(){
    var c = copy[track];
    document.body.dataset.track = track;
    $('#share').addEventListener('click', function(){
    var m = $('#share-msg');
    var label = track === 'android' ? 'Android' : 'Backend';
    var url;
    try {
      url = new URL(window.location.href);
      url.searchParams.set('track', track);
      url.hash = '';
      url = url.toString();
    } catch (e) {
      url = location.origin + location.pathname + '?track=' + track;
    }

    var done = function(t){ m.textContent = t; setTimeout(function(){ m.textContent = ''; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function(){ done(label + ' link copied ✓'); },
        function(){ done(url); }
      );
    } else {
      done(url);
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.trk'), function(b){ b.setAttribute('aria-pressed', String(b.dataset.track === track)); });
    $('#h1').textContent = c.h1; $('#sub').textContent = c.sub;
    $('#years-proof').textContent = c.years; $('#years-proof-sub').textContent = c.yearsSub;
    var cta = $('#cta'); cta.textContent = c.cta; cta.setAttribute('href', c.href);
    $('#work h2').textContent = c.workH; $('#android h2').textContent = c.andH;
    $('#contact-h').textContent = c.contact;
    stackEl.innerHTML = track === 'android' ? androidStack : backendStack;

    var shareBtn = $('#share');
    if (shareBtn) {
      shareBtn.textContent = track === 'android' ? 'Copy Android link' : 'Copy Backend link';
      shareBtn.setAttribute('aria-label', shareBtn.textContent);
    }

    var featuredAllLink = $('#featured-all-link');
    if(featuredAllLink){
      featuredAllLink.setAttribute('href', track === 'android' ? '#android' : '#work');
    }
  }
  function setTrack(t){
    if (t === track) return;
    runId++; track = t;
    current = sims.findIndex(function(s){ return s.kind.toLowerCase() === t; });
    applyTrack(); renderTabs(); renderSim();

    /* Track switches never auto-run on desktop, tablet, or mobile.
       The newly selected role waits for an explicit Run. */
    try { history.replaceState(null, '', '?track=' + t + location.hash); } catch (e) {}
  }
  Array.prototype.forEach.call(document.querySelectorAll('.trk'), function(b){ b.addEventListener('click', function(){ setTrack(b.dataset.track); }); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-switch-track]'), function(b){
    b.addEventListener('click', function(){
      var targetTrack=b.getAttribute('data-switch-track');
      setTrack(targetTrack);
      var targetSection = targetTrack === 'android' ? document.getElementById('android') : document.getElementById('work');
      if(targetSection){
        targetSection.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block:'start'});
      }
    });
  });

  var q = ''; try { q = new URLSearchParams(location.search).get('track'); } catch (e) {}
  if (q === 'android') { track = 'android'; current = sims.findIndex(function(s){ return s.kind === 'Android'; }); }
  applyTrack(); renderTabs(); renderSim();

  /* Initial load: do not auto-run Renegan.
     Tablet opens in Build and mobile opens in Configure.
     Any project switch also resets to Build/Configure via renderSim().
     Observe/Events is only entered after the user explicitly clicks Run. */

  /* work filter */
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var cases = Array.prototype.slice.call(document.querySelectorAll('#work .case'));
  var status = $('#filter-status');
  chips.forEach(function(c){
    c.addEventListener('click', function(){
      var on = c.getAttribute('aria-pressed') === 'true';
      chips.forEach(function(x){ x.setAttribute('aria-pressed', 'false'); });
      if (!on) c.setAttribute('aria-pressed', 'true');
      var tag = on ? null : (c.dataset.tag || null), n = 0;
      cases.forEach(function(r){
        var match = !tag || r.dataset.tags.split('|').indexOf(tag) > -1;
        r.classList.toggle('dim', !match);
        if (tag) r.open = match;
        if (match) n++;
      });
      status.textContent = tag ? n + ' of ' + cases.length + ' roles involved ' + tag.toLowerCase() + '.' : 'Showing all roles.';
    });
  });

  /* resume preview
     Mobile Chrome/Safari can expose only the first page of an embedded PDF.
     On small screens we therefore render the resume as normal page images
     inside the portfolio. Desktop/tablet keep the PDF iframe preview. */
  var pBtn = $('#toggle-preview'), pBox = $('#preview'), frame = pBox.querySelector('iframe');
  var mobileResume = $('#mobile-resume-preview');

  function isMobileResumePreview(){
    return window.matchMedia('(max-width: 700px)').matches;
  }

  function syncResumePreviewButton(){
    if(!pBtn) return;

    if(isMobileResumePreview()){
      var mobileOpen = mobileResume && !mobileResume.hidden;
      pBtn.textContent = mobileOpen ? 'Hide resume' : 'Preview resume';
      pBtn.setAttribute('aria-expanded', String(mobileOpen));
      pBtn.setAttribute('aria-controls', 'mobile-resume-preview');
      pBtn.setAttribute('aria-label', pBtn.textContent);
      pBox.classList.remove('show');
    } else {
      if(mobileResume) mobileResume.hidden = true;
      var show = pBox.classList.contains('show');
      pBtn.textContent = show ? 'Hide preview' : 'Preview here';
      pBtn.setAttribute('aria-expanded', String(show));
      pBtn.setAttribute('aria-controls', 'preview');
      pBtn.setAttribute('aria-label', pBtn.textContent);
    }
  }

  pBtn.addEventListener('click', function(){
    if(isMobileResumePreview()){
      var showMobile = mobileResume.hidden;
      mobileResume.hidden = !showMobile;
      if(showMobile){
        mobileResume.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block:'start'});
      }
      syncResumePreviewButton();
      return;
    }

    var show = !pBox.classList.contains('show');
    if (show && !frame.src) frame.src = frame.dataset.src;
    pBox.classList.toggle('show', show);
    syncResumePreviewButton();
  });

  window.addEventListener('resize', syncResumePreviewButton);
  syncResumePreviewButton();

  /* copy email */
  var email = 'arthurokolo97@gmail.com', msg = $('#copy-msg');
  $('#copy').addEventListener('click', function(){
    var done = function(t){ msg.textContent = t; setTimeout(function(){ msg.textContent = ''; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(email).then(function(){ done('Email copied'); }, function(){ done('Copy failed. Use ' + email); });
    } else { done('Copy failed. Use ' + email); }
  });

  /* featured cards jump to the detailed matching case */
  Array.prototype.forEach.call(document.querySelectorAll('[data-jump]'), function(link){
    link.addEventListener('click', function(e){
      var name = link.getAttribute('data-jump'), target = null;
      Array.prototype.forEach.call(document.querySelectorAll('.case'), function(el){
        var h = el.querySelector('h3');
        if (h && h.textContent.trim() === name) target = el;
      });
      if (!target) return;
      e.preventDefault();
      target.open = true;
      target.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block:'center'});
      target.classList.add('flash');
      setTimeout(function(){ target.classList.remove('flash'); }, 1400);
    });
  });

})();

  /* Experience accordions: one open item per section. */
  document.querySelectorAll('.compact-cases').forEach(function(group){
    group.querySelectorAll('details.compact-case').forEach(function(item){
      item.addEventListener('toggle', function(){
        if(!item.open) return;
        group.querySelectorAll('details.compact-case[open]').forEach(function(other){
          if(other !== item) other.open = false;
        });
      });
    });
  });
