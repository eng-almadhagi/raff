# تجهيز مستودع GitHub

لا يعتمد موقع رَفّ الثابت على Docker أو خادم Python عند النشر. يستخدم GitHub Pages ملفات HTML/CSS/JavaScript وملفات البحث المصرح بنشرها. Python مطلوب فقط لأدوات إعداد البيانات أو خادم الملفات أثناء التجربة المحلية.

1. سجل الدخول إلى GitHub واختر New repository، وسمّه `raff` (أو الاسم الذي تفضله).
2. أنشئه فارغًا؛ لا تضف README أو `.gitignore` أو License تلقائيًا، لأن المشروع يحتوي ملفاته.
3. أرسل رابط المستودع. لا ترسل كلمة المرور أو رمز الدخول في المحادثة.
4. بعد ربط الكود، افتح Settings → Pages واختر GitHub Actions. لن ينشر سير العمل بيانات البحث المحلية؛ يتطلب حزمة محتوى مصرحًا بها ومعتمدة.

بعد حسم حقوق النشر والمراجعة، تُجهز حزمة ZIP تحتوي `catalog.json` و`settings.json` و`vocabulary.json` في جذرها وملفات `data/` المعتمدة. تُتاح كرابط HTTPS عام (مثل أصل إصدار GitHub Release)، ثم يُشغّل **Deploy approved static Raf** من Actions مع الرابط وبصمة SHA-256. يتحقق التنزيل من البصمة والمسارات والحجم، ثم يتحقق البناء من اعتماد كل مصدر وبصمات ملفاته. لا تستخدم الحزمة البحثية الحالية كما هي؛ يرفضها البناء. هذه الحزمة تكون متاحة للعموم، وليست وسيلة لحفظ المحتوى سرًا.

إذا أردت الربط بنفسك بعد تثبيت Git، استخرج **حزمة الكود فقط** إلى مجلد نظيف، ثم نفذ فيه:

```powershell
git init
git add .
git commit -m "Prepare Raff static platform"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/raff.git
git push -u origin main
```

استبدل الرابط بالرابط الحقيقي، واستخدم تسجيل GitHub الآمن عند طلبه. لا تنفذ `git add -f private` ولا ترفع `var/` أو النصوص أو الفهارس أو المفاتيح. ملف ZIP للكود ليس نشرًا فعليًا، والمستودع وحده لا يشغل البحث دون حزمة المحتوى المصرح بها.

المراجع الرسمية التي روجعت: [إنشاء موقع Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) و[حدود Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). حد الموقع المنشور 1 GB، وحد النقل المرن 100 GB شهريًا؛ حجم النموذج يجعل التحميل الأول مهمًا عند تقدير عدد الزيارات.
