import { describe, expect, it } from 'vitest';
import { ruleMatches } from '../../src/domain/categorise';
import { handleName, isForexMarkup, payeeOf } from '../../src/domain/payee';

describe('payeeOf', () => {
  it.each([
    // SBI UPI keeps the name it prints, cut short or not.
    ['WDL TFR UPI/DR/512345678901/ACME TOYS/YESB/acme.toys/Paym 0097690162095 AT 01234 SOMEPLACE', 'ACME TOYS'],
    ['DEP TFR UPI/CR/512345678901/JANE DOE/SBIN/jane@okaxis/Rent', 'JANE DOE'],
    ['WDL TFR UPI/DR/512345678901/M/S. ACME/ICIC/ibkPOS.EP0/Paym', 'M/S. ACME'],
    // Federal UPI names the handle; gateway tags and shop numbers go.
    ['UPIOUT/512345678901/netflixupi.payu@hdfcbank/4899', 'NETFLIXUPI'],
    ['UPIOUT/512345678901/acmestreamindi518164.rz/5815', 'ACMESTREAMINDI'],
    ['UPIOUT/512345678901/paytm-mygate@ptybl/Payme/5331', 'MYGATE'],
    ['UPIOUT/512345678901/anomaly.cb.cfp@axisbank//7372', 'ANOMALY'],
    ['UPI IN/512345678901/airtelautopay.payu@hdfcb/0000', 'AIRTELAUTOPAY'],
    // No name in the handle: a phone number, a QR code, a gateway's merchant code.
    ['UPIOUT/512345678901/9876543210@axl/Payment f/0000', '9876543210@AXL'],
    ['UPIOUT/512345678901/Q123456789@ybl/Payment f/5441', 'Q123456789@YBL'],
    ['UPIOUT/512345678901/BHARATPE.9T0Y0E0P3Q40014/7407', 'BHARATPE.9T0Y0E0P3Q40014'],
    // Card spends, with the merchant's address and the forex markup's row.
    ['TO ECM/791999/ACME AI \\1450 Page Mil', 'ACME AI'],
    ['TO INTL. ECM DCC/798087/ACME AI \\145', 'ACME AI'],
    ['TO INTL. ECM MRK/612912464911/ACME.AI SUBSCRIPTI', 'ACME.AI SUBSCRIPTI'],
    ['POS/613014340501/ACME STYLE \\ACME/20:06', 'ACME STYLE'],
    ['POS ATM PURCH OTHPG 614308898332ACMESHOP 224092000', 'ACMESHOP'],
    ['POS ATM PURCH OTHPG 626911478814ACME* AI SUB +14152360', 'ACME* AI SUB'],
    // Mandates and bank transfers.
    ['DEBIT ACHDr YESB00709000028661 Acme Clearin', 'ACME CLEARIN'],
    ['DEBIT ACHDr NACH00000000002029 Acme Life', 'ACME LIFE'],
    ['ACH D- ACME BROADBAND', 'ACME BROADBAND'],
    ['ACHDR/CTACMEPAY/FDRL7022912220000931/STAN:124971', 'CTACMEPAY'],
    ['DEP TFR NEFT*HDFC0000240*HDFCH0117 4329570*ACME MUTUAL FU 0099509044300 AT 01234 SOMEPLACE', 'ACME MUTUAL FU'],
    ['WDL TFR IMPS/615812533720/ICIC-xx024- Jane Doe/Transfer 0098298162092 AT 01234 SOMEPLACE', 'JANE DOE'],
    ['DIRECT DR 0041836314740 OF Mr. JOHN DOE AT 01234 SOMEPLACE, CITY', 'JOHN DOE'],
  ])('%s', (description, payee) => {
    expect(payeeOf(description)).toBe(payee);
  });

  it('has no payee for interest and charges', () => {
    expect(payeeOf('INTEREST CREDIT')).toBeNull();
    expect(payeeOf('Sms Charges ForJune Qtr ,2026')).toBeNull();
  });

  it('gives a payee a rule finds again in its narration', () => {
    for (const description of [
      'UPIOUT/512345678901/netflixupi.payu@hdfcbank/4899',
      'TO ECM/791999/ACME AI \\1450 Page Mil',
      'DEBIT ACHDr YESB00709000028661 Acme Clearin',
      'UPIOUT/512345678901/9876543210@axl/Payment f/0000',
    ]) {
      const pattern = payeeOf(description)!;
      expect(ruleMatches({ id: 'r', pattern, isRegex: false, category: 'X', priority: 1 }, { description, amount: -1 }), description).toBe(true);
    }
  });
});

describe('handleName', () => {
  it('reads a name only when the handle has one', () => {
    expect(handleName('playstore1.bd@axisbank')).toBe('PLAYSTORE');
    expect(handleName('jio@citibank')).toBe('JIO@CITIBANK');
    expect(handleName('paytm-648052425@ptybl')).toBe('PAYTM-648052425@PTYBL');
  });
});

describe('isForexMarkup', () => {
  it('spots the markup row a foreign card spend comes with', () => {
    expect(isForexMarkup('TO INTL. ECM DCC/798087/ACME AI \\145')).toBe(true);
    expect(isForexMarkup('TO ECM/791999/ACME AI \\1450 Page Mil')).toBe(false);
  });
});
