const AFFIRMATIVE_CONFIRMATION = /^(?:yes|yeah|yep|y|yes please|haan|han|ha|ji haan|haan please|bilkul|confirm|confirm it|confirm and save|save it|kar do|kardo|theek hai|ठीक है|हाँ|हां|जी हाँ|बिल्कुल|पुष्टि करें|सेव करो|कर दो)[.!\s]*$/iu;

export function isAffirmativeConfirmation(value) {
  return AFFIRMATIVE_CONFIRMATION.test(String(value ?? "").normalize("NFKC").trim());
}
