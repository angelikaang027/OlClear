import { createContext, useContext, useMemo, useState } from 'react';
import { CLEARANCE_OFFICES, initialClearance } from '../data/clearance';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [role, setRole] = useState('STUDENT');
  const [clearance, setClearance] = useState(initialClearance);
  const [periodActive, setPeriodActive] = useState(true);
  const [periodName, setPeriodName] = useState('1st Semester · 2026–2027');
  const [department, setDepartment] = useState('CICTE');
  const [staffOffice, setStaffOffice] = useState('Department Dean');
  const [staffName, setStaffName] = useState('Mariel D. Ramos');

  const changeStatus = (office, status, remark) => {
    setClearance((items) => items.map((item) => item.office === office
      ? { ...item, status, ...(remark !== undefined ? { remark } : {}) }
      : item));
  };
  const clearedCount = clearance.filter((item) => item.status === 'APPROVED').length;
  const value = useMemo(() => ({
    role, setRole, clearance, clearedCount, changeStatus, periodActive, setPeriodActive,
    periodName, setPeriodName, department, setDepartment, staffOffice, setStaffOffice,
    staffName, setStaffName, officeCount: CLEARANCE_OFFICES.length,
  }), [role, clearance, clearedCount, periodActive, periodName, department, staffOffice, staffName]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used inside AppProvider');
  return context;
}

export const palette = {
  forest: '#1F4B2C', forestDeep: '#15381F', lime: '#C3E956', canvas: '#F5F7F2',
  ink: '#18221A', muted: '#718075', line: '#E6EBE3', white: '#FFFFFF',
};
