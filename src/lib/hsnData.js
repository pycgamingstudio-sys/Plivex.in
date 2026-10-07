/**
 * HSN/SAC Master data (PDF Module 2)
 * Subset of common GST HSN codes for instant autocomplete
 */
export const HSN_MASTER = [
  { hsn_code: "0101", description: "Live horses, asses, mules and hinnies", gst_rate: 0 },
  { hsn_code: "0201", description: "Meat of bovine animals fresh or chilled", gst_rate: 0 },
  { hsn_code: "1001", description: "Wheat and meslin", gst_rate: 0 },
  { hsn_code: "1006", description: "Rice", gst_rate: 0 },
  { hsn_code: "1905", description: "Bread, pastry, cakes, biscuits and other bakers wares", gst_rate: 18 },
  { hsn_code: "2101", description: "Extracts, essences and concentrates of coffee tea or mate", gst_rate: 18 },
  { hsn_code: "2202", description: "Waters mineral waters aerated waters sweetened or flavoured beverages", gst_rate: 28 },
  { hsn_code: "3004", description: "Medicaments pharmaceutical drugs medicines", gst_rate: 12 },
  { hsn_code: "3401", description: "Soap organic surface active products washing powder detergent", gst_rate: 18 },
  { hsn_code: "3923", description: "Articles for conveyance or packing of goods plastic bottles containers", gst_rate: 18 },
  { hsn_code: "4901", description: "Printed books newspapers periodicals brochures", gst_rate: 0 },
  { hsn_code: "6101", description: "Men clothing overcoats car-coats capes cloak anoraks", gst_rate: 12 },
  { hsn_code: "6201", description: "Men garments overcoats raincoats car-coats capes", gst_rate: 12 },
  { hsn_code: "6402", description: "Footwear shoes sandals boots outer soles uppers rubber plastics", gst_rate: 18 },
  { hsn_code: "7113", description: "Articles of jewellery parts thereof precious metal gold silver", gst_rate: 3 },
  { hsn_code: "8414", description: "Air pumps vacuum pumps air or gas compressors fans", gst_rate: 18 },
  { hsn_code: "8471", description: "Automatic data processing machines computers laptops tablets", gst_rate: 18 },
  { hsn_code: "8517", description: "Telephone sets mobile phones smartphones", gst_rate: 18 },
  { hsn_code: "8703", description: "Motor cars and vehicles principally designed for transport of persons", gst_rate: 28 },
  { hsn_code: "8802", description: "Aircraft helicopters aeroplanes powered aircraft", gst_rate: 5 },
  { hsn_code: "9403", description: "Furniture wooden office chairs tables", gst_rate: 18 },
  { hsn_code: "9503", description: "Tricycles scooters toy vehicles dolls games toys", gst_rate: 12 },
  // SAC codes for services
  { hsn_code: "9983", description: "Software development IT services information technology", gst_rate: 18 },
  { hsn_code: "9984", description: "Telecommunications internet broadband services", gst_rate: 18 },
  { hsn_code: "9972", description: "Real estate services property rental leasing", gst_rate: 18 },
  { hsn_code: "9961", description: "Retail trade services wholesale trading goods", gst_rate: 18 },
  { hsn_code: "9971", description: "Financial services banking insurance mutual funds", gst_rate: 18 },
  { hsn_code: "9954", description: "Construction services building civil works contractor", gst_rate: 12 },
  { hsn_code: "9993", description: "Education training services tuition coaching classes", gst_rate: 0 },
  { hsn_code: "9991", description: "Government public administration services", gst_rate: 0 },
  { hsn_code: "9985", description: "Support services packaging courier logistics transportation", gst_rate: 18 },
  { hsn_code: "9997", description: "Other services repair maintenance cleaning", gst_rate: 18 },
  { hsn_code: "9963", description: "Accommodation food restaurant hotel catering services", gst_rate: 5 },
  { hsn_code: "9987", description: "Maintenance repair installation services equipment machinery", gst_rate: 18 },
  { hsn_code: "9962", description: "Printing publishing advertising media design branding services", gst_rate: 18 },
  { hsn_code: "9981", description: "Legal accounting auditing chartered accountant services", gst_rate: 18 },
  { hsn_code: "9968", description: "Postal courier delivery parcel services", gst_rate: 18 },
  { hsn_code: "9967", description: "Supporting transport services freight forwarding logistics", gst_rate: 18 },
  { hsn_code: "9969", description: "Electricity gas water utility distribution services", gst_rate: 18 },
  { hsn_code: "9995", description: "Healthcare medical hospital doctor dentist services", gst_rate: 0 },
];

export function searchHSN(query, limit = 5) {
  if (!query || query.trim().length < 2) return [];
  const q = query.toLowerCase();
  const results = HSN_MASTER.map((item) => {
    const desc = item.description.toLowerCase();
    const code = item.hsn_code.toLowerCase();
    let score = 0;
    if (desc.startsWith(q)) score = 100;
    else if (desc.includes(q)) score = 80;
    else if (code.startsWith(q)) score = 70;
    else {
      const words = q.split(/\s+/);
      const matchedWords = words.filter((w) => w.length > 2 && desc.includes(w));
      score = (matchedWords.length / words.length) * 60;
    }
    return { ...item, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return results;
}