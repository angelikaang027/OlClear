import {
  BookOpen,
  Building2,
  Calculator,
  FileText,
  GraduationCap,
  Landmark,
  ShieldCheck,
  Stethoscope,
  UsersRound,
} from 'lucide-react-native';

export const OFFICES = [
  { code: 'ACCOUNTING', name: 'Accounting Office', label: 'Accounting', icon: Calculator },
  { code: 'REGISTRAR', name: 'Registrar Office', label: 'Registrar', icon: FileText },
  { code: 'DEAN', name: 'Department Dean', label: 'Department Dean', icon: GraduationCap, departmentSpecific: true },
  { code: 'DIRECTOR_SAS', name: 'Director / SAS', label: 'Director / SAS', icon: Building2 },
  { code: 'GUIDANCE', name: 'Guidance Counselor', label: 'Guidance', icon: ShieldCheck },
  { code: 'ADVISER', name: 'Organization Adviser', label: 'Organization Adviser', icon: UsersRound, departmentSpecific: true },
  { code: 'PROPERTY', name: 'Property Custodian', label: 'Property', icon: Landmark },
  { code: 'LIBRARIAN', name: 'Librarian', label: 'Librarian', icon: BookOpen },
  { code: 'COUNCIL', name: 'Student Council', label: 'Student Council', icon: UsersRound },
  { code: 'CLINIC', name: 'School Clinic', label: 'School Clinic', certificateTitle: 'Medical & Dental Clinic', icon: Stethoscope },
];

export const OFFICE_BY_CODE = Object.fromEntries(OFFICES.map((office) => [office.code, office]));
export const OFFICE_BY_NAME = Object.fromEntries(OFFICES.map((office) => [normalizeOfficeName(office.name), office]));
export const OFFICE_ICON_BY_CODE = Object.fromEntries(OFFICES.map((office) => [office.code, office.icon]));

export function normalizeOfficeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getOffice(value) {
  const normalized = normalizeOfficeName(value);
  return OFFICE_BY_CODE[String(value || '').toUpperCase()]
    || OFFICE_BY_NAME[normalized]
    || OFFICES.find((office) => normalizeOfficeName(office.label) === normalized)
    || null;
}
