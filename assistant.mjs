// PillarSpec public/owner reply policy. No paid API calls unless explicitly enabled.
export function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function isOwner(sender, ownerPhone) {
  return Boolean(ownerPhone && normalizePhone(sender) && normalizePhone(sender) === normalizePhone(ownerPhone));
}

const hasArabic = text => /[\u0600-\u06ff]/u.test(text);

export function faqReply(input, owner = false) {
  const trimmed = String(input ?? '').slice(0, 3000);
  const t = trimmed.toLocaleLowerCase();
  const ar = hasArabic(t);
  const reply = (english, arabic, category, human = false) => ({
    body: ar ? arabic : english, category, humanReview: human, language: ar ? 'ar' : 'en'
  });

  if (owner) return reply(
    'PillarSpec Jarvis private channel recognized. Private notes and tasks work with /help. AI analysis and web research require the configured AI service. Email, calendars and other accounts require their own integrations; no external action has been taken.',
    'تم التعرف على قناة PillarSpec Jarvis الخاصة. تتوفر الملاحظات والمهام عبر /help. يتطلب التحليل والبحث تفعيل خدمة AI. البريد والتقويم والحسابات الأخرى تحتاج إلى ربط مستقل؛ لم يتم تنفيذ إجراء خارجي.',
    'owner');
  if (/\b(quotation|quote|pricing|price|fees|cost|rfq|offer)\b|سعر|أسعار|تكلفة|عرض سعر|تسعير/u.test(t)) return reply(
    'For a PillarSpec quotation, please provide the service requested, product, estimated quantity, port/terminal, vessel (if relevant), and operation date. Our team must review availability and provide a formal quotation. Any prices we quote are in USD.',
    'لطلب عرض سعر من PillarSpec، يرجى إرسال نوع الخدمة والمنتج والكمية التقريبية والمرفأ أو المحطة واسم السفينة (إن وجد) وتاريخ العملية. تتم مراجعة التوفر والتسعير من قبل الفريق، وتكون الأسعار بالدولار الأميركي.',
    'quotation', true);
  if (/\b(sts|ship[ -]to[ -]ship)\b|سفينة.*سفينة|نقل.*سفينة/u.test(t)) return reply(
    'For ship-to-ship (STS) supervision, please share the port/anchorage, both vessels, product, estimated quantity, and expected date. Our team will confirm the service scope and availability.',
    'للاستفسار عن الإشراف على النقل من سفينة إلى أخرى (STS)، يرجى تحديد الموقع والسفينتين والمنتج والكمية التقريبية والتاريخ المتوقع. يؤكّد فريقنا نطاق الخدمة والتوفر.',
    'sts', true);
  if (/\b(loss[ -]?control|shortage|discrepanc(y|ies)|outturn)\b|فاقد|عجز|فروقات/u.test(t)) return reply(
    'For petroleum cargo loss control or quantity discrepancies, please share the product, vessels/tanks, location, and relevant loading/discharge dates. We will arrange a technical review.',
    'لمراقبة الفاقد أو فروقات الكمية في الشحنات النفطية، يرجى إرسال المنتج والسفن أو الخزانات والموقع وتواريخ التحميل أو التفريغ ليتم إجراء مراجعة فنية.',
    'loss_control', true);
  if (/\b(loading|discharge|discharging|unloading|cargo supervision)\b|تحميل|تفريغ|إشراف/u.test(t)) return reply(
    'For loading or discharge supervision, please provide vessel name, port/terminal, product, approximate quantity, and operation date. Our team will review your enquiry.',
    'لخدمات الإشراف على التحميل أو التفريغ، يرجى إرسال اسم السفينة والمرفأ أو المحطة والمنتج والكمية التقريبية وتاريخ العملية لمراجعة الطلب.',
    'cargo_supervision', true);
  if (/\b(lab(oratory)?|sampling|testing|quality|quantity|inspection|survey|petroleum|cargo)\b|فحص|مختبر|عيّنات|عينات|جودة|كمية|نفط|معاينة/u.test(t)) return reply(
    'PillarSpec receives enquiries concerning petroleum cargo quantity and quality inspections, sampling and related marine services. Please share the product, location, required service, quantity, and date for review.',
    'تستقبل PillarSpec طلبات فحص كمية وجودة الشحنات النفطية وأخذ العينات والخدمات البحرية ذات الصلة. يرجى إرسال نوع المنتج والموقع والخدمة والكمية والتاريخ لمراجعة الطلب.',
    'inspection', true);
  if (/\b(hi|hello|hey|good morning|good evening|help|services|about)\b|مرحبا|أهلا|اهلا|السلام|خدمات/u.test(t)) return reply(
    'Welcome to PillarSpec SARL. Please tell us whether you need petroleum cargo inspection, quantity/quality verification, STS supervision, loading/discharge supervision, or loss control. We can arrange a team review of your enquiry.',
    'أهلاً بكم في PillarSpec SARL. يرجى تحديد الخدمة المطلوبة: فحص الشحنات النفطية، التحقق من الكمية والجودة، الإشراف على STS أو التحميل والتفريغ، أو مراقبة الفاقد. يمكن تحويل طلبكم للمراجعة.',
    'greeting');
  return reply(
    'Thank you for contacting PillarSpec SARL. Please describe the service you need, product, location and proposed date. Our team can review your enquiry. We cannot confirm prices, availability or commercial commitments automatically.',
    'شكراً لتواصلكم مع PillarSpec SARL. يرجى شرح الخدمة المطلوبة والمنتج والموقع والتاريخ المقترح ليتمكن الفريق من مراجعة الطلب. لا يمكن تأكيد الأسعار أو التوفر أو أي التزامات تجارية تلقائياً.',
    'general', true);
}

export { generateAiReply } from './ai.mjs';
