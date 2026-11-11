# GST Return Tool — Meesho / Amazon / Flipkart → GSTR-1 JSON

Online sellers ke liye offline tool. Aap har platform ki sales report daaliye. Tool **calculate** karega, sab kuch **verify** karega, aur ek **GSTR-1 JSON** file banayega. Is JSON ko GST portal par upload karte hi GSTR-1 apne aap bhar jaata hai.

Sab kuch aapke browser mein hi chalta hai. Koi server nahi hai, aur aapka data kahin upload nahi hota.

## Kaise chalayein

1. Repo download/clone kijiye aur `index.html` ko browser (Chrome/Edge) mein double-click karke kholiye.
   Internet ki zaroorat nahi hai.
2. Apna **GSTIN** aur **return month** chuniye.
3. Platforms ki report files drag & drop kijiye. Ek saath kai files daal sakte hain.
4. Platforms ke **TCS GSTIN** daaliye (Table 14 ke liye). Ye ek baar daalne par browser yaad rakhta hai.
5. Verification report dekhiye, phir **GSTR-1 JSON download** kijiye.
6. GST portal → Returns Dashboard → GSTR-1 → **Prepare Offline → Upload** → JSON chuniye.
   Process hone ke baad **Generate Summary → File with DSC/EVC**.

Demo ke liye `sample-data/` folder ki saari files ek saath upload kijiye
(GSTIN `27AAPFU0939F1ZV`, October 2025).

## Kaun si report kahan se

| Platform | Report | Notes |
|---|---|---|
| Amazon | Seller Central → Reports → Tax Document Library → **MTR** (B2C + B2B) | CSV. Shipment/Refund/Cancel sab samajh leta hai |
| Flipkart | Seller Hub → Reports → Tax Reports → **Sales Report** | Poori Excel daaliye. "Sales Report" aur "Cash Back Report" (cashback ke credit/debit notes) dono padhe jaate hain |
| Meesho | Supplier Panel → Payments → **GST Report** | `tcs_sales.xlsx` + `tcs_sales_return.xlsx` dono |
| Baaki sab (JioMart, Myntra, apni website, offline) | Tool ka **template** (`sample-data/other_platforms_template.csv`, ya app mein "Template download") | Tax khali chhodenge to rate se calculate ho jayega |

## Koi report pehchani na jaye to

- **"0 rows" aana:** Flipkart ki kuch Excel files ke andar galat range likhi hoti hai (sirf header row tak). Tool ab ise apne aap theek kar leta hai aur saari rows padhta hai.
- **"Format pehchana nahi gaya":** file ke saamne **Columns khud chuniye** dabaiye.
  Tool andaaze se columns pehle hi bhar deta hai (taxable value, state, rate, IGST/CGST/SGST, HSN...). Aap bas check kijiye aur preview dekh kar save kijiye.
  Mapping browser mein yaad rehti hai, isliye agle mahine wahi report apne aap padhi jayegi.
- Flipkart ki **Cash Back Report** ab calculation mein shamil hai: credit note sale ko kam karta hai, debit note badhata hai. HSN, state ya rate na ho to usi order ki sale se le liya jaata hai. Ye notes Table 13 mein bhi jaate hain (Debit Note = 4, Credit Note = 5).
- Jis file mein ek report sheet pehchan li gayi, uski baaki sheets (jaise Help) chhod di jaati hain. Zaroorat ho to sheet ke naam par click karke unhe bhi map kar sakte hain.

## TCS credit se sales ka milaan

E-commerce platform har mahine aapki net sale aur kata hua TCS GST portal par report karta hai (GSTR-8).
Agar aapke GSTR-1 ke figures us se match na hon, to notice aa sakta hai. Isliye file karne se pehle milaan zaroori hai.

1. GST portal → **Services → Returns → Returns Dashboard** → month chuniye → **TDS and TCS Credit Received** → **TCS** tab.
2. Har platform ki line se ye 6 numbers tool ke **"TCS credit se sales ka milaan"** box mein bhariye:
   Gross value, Returns, Net amount, IGST, CGST, SGST.
3. Tool har platform ke liye batata hai:
   - **✓ Match**, **≈ Thoda farak** (₹100 ya 0.5% tak), ya **✗ Match nahi**
   - Sales, returns aur net value mein kitna farak hai
   - Aapki sale par kitna TCS banna chahiye: 0.5% (Jul 2024 se pehle 1%). Inter-state par IGST, same state par CGST + SGST.
   - Farak ki sambhavit wajah, jaise pichhle mahine ke returns, chhooti hui report file, ya customer state ka alag hona

Bhare hue numbers har GSTIN aur mahine ke liye browser mein yaad rehte hain. Excel report mein **"TCS milaan"** sheet bhi aati hai.

## HSN milaan

- GST portal ki **official HSN/SAC list** (22,609 codes, tutorial.gst.gov.in se) tool ke andar hi hai. Kuch download nahi karna.
- Har HSN code us list se check hota hai:
  - ✓ Valid
  - ⚠ Sirf 4/6-digit heading valid hai
  - ❌ List mein nahi (portal reject karega)
- GSTR-1 JSON mein HSN ki **official description** jaati hai.
- Turnover ₹5 crore se zyada chuna ho to 6-digit se chhote HSN par warning aati hai.
- Ek hi SKU alag-alag platforms par alag HSN se bika ho, ya ek HSN alag-alag GST rate par bika ho, to bhi tool batata hai.
- List update karni ho to tool mein "Nayi HSN list load kijiye" se naya `HSN_SAC.xlsx` daaliye.
  Developers: `data/HSN_SAC.xlsx` badal kar `npm run hsn` chalaiye.
> gst-tool@1.0.0 hsn
> node tools/build-hsn-master.js

Wrote js/hsn-master.js with 22609 codes chalaiye.

## Tool kya calculate karta hai

| GSTR-1 table | JSON key | Kya jaata hai |
|---|---|---|
| 4A – B2B | `b2b` | Buyer GSTIN wali sales (jaise Amazon Business) |
| 5 – B2CL | `b2cl` | Unregistered buyer ko inter-state invoice > ₹1 lakh |
| 7 – B2CS | `b2cs` | Baaki B2C sales: state + rate ke hisaab se, **returns minus karke (net)** |
| 8 – Nil/Exempt | `nil` | 0% GST wali sales |
| 9B – CDNR | `cdnr` | B2B returns ke credit notes |
| 12 – HSN | `hsn.hsn_b2b` / `hsn.hsn_b2c` | HSN + rate wise summary, B2B aur B2C alag |
| 13 – Documents | `doc_issue` | Invoice / credit note series (from–to, count) |
| 14(a) – ECO supplies | `supeco.clttx` | Platform-wise net sale jis par platform TCS kaat-ta hai |

Iske alawa screen par aur Excel report mein ye bhi milta hai:
- **GSTR-3B** Table 3.1 aur 3.2 ke numbers, milaan karne ke liye
- Platform-wise sales / returns
- Saari rows ki detail

## Verification (kya check hota hai)

- Aapka GSTIN aur platforms ke TCS GSTIN: format + checksum
- Report mein kisi **doosre GSTIN** ki rows → alag kar di jaati hain (multi-state sellers ke liye)
- Return period ke bahar ki dates. Chahein to un rows ko hata bhi sakte hain.
- Tax amount = taxable value × rate (₹1 / 1% tolerance)
- Same state par IGST, ya doosre state par CGST/SGST lagaya gaya ho → JSON mein sahi head mein daala jaata hai
- Galat GST rate slab, HSN missing/galat, state naam samajh na aaye
- Buyer GSTIN galat ho to sale B2C mein jaati hai
- Duplicate rows (same file do baar upload)
- Cancelled zero-value orders skip

## Dhyan dein

- Meesho ki report mein invoice number nahi hota, isliye Meesho ki invoice series (Table 13) portal par khud bhariye.
- Platforms ke report formats kabhi-kabhi badalte hain. Agar koi file "Format pehchana nahi gaya" dikhaye, to template use kijiye ya issue banaiye.
- Ye tool madad ke liye hai. File karne se pehle numbers ek baar zaroor check kijiye (ya CA se karwaiye).

## Developers

```bash
npm install
```

```bash
npm test
```

```bash
npm run samples
```

- `js/gst-core.js`: state codes, GSTIN checksum, verification, GSTR-1 JSON builder (browser + Node)
- `js/parsers.js`: Amazon / Flipkart / Meesho / generic report parsers
- `js/app.js`: UI
- `js/vendor/xlsx.full.min.js`: SheetJS 0.18.5 (bundled, taaki tool offline chale)
