export const ACCOUNTING_REQUIRED_MESSAGE = 'Accounting Prerequisite Required: You must submit your proof of payment and receive Accounting approval before accessing this office.';

export const isAccountingApproved = (clearanceItems = []) => {
  return clearanceItems.some((item) => {
    const officeRelation = Array.isArray(item.offices) ? item.offices[0] : item.offices;
    const isAccounting = String(officeRelation?.code || item.office_code || '').toUpperCase() === 'ACCOUNTING';
    return isAccounting && String(item.status || '').toUpperCase() === 'APPROVED';
  });
};

export const isOfficeUnlocked = (officeCode, clearanceItems = []) => {
  if (String(officeCode || '').toUpperCase() === 'ACCOUNTING') return true;
  return isAccountingApproved(clearanceItems);
};
