import { OFFICES } from './offices.js';

const SIGNATORY_TITLES = {
  HIGH_SCHOOL: {
    DEAN: 'High School Principal',
    ADVISER: 'Club Adviser',
    COUNCIL: 'Student Government Adviser',
    CLINIC: 'Medical & Dental Clinic',
  },
  UNDERGRADUATE: {
    DEAN: 'Department Dean',
    ADVISER: 'Organization Adviser',
    COUNCIL: 'Student Council Adviser',
    CLINIC: 'Medical & Dental Clinic',
  },
  POSTGRADUATE: {
    DEAN: 'Graduate Program Dean',
    ADVISER: 'Graduate Student Adviser',
    COUNCIL: 'Graduate Student Council Adviser',
    CLINIC: 'Medical & Dental Clinic',
  },
};

function createSignatories(level) {
  return OFFICES.map((office) => ({
    office: office.code,
    name: office.name,
    title: SIGNATORY_TITLES[level][office.code] || office.certificateTitle || office.name,
  }));
}

export const CERTIFICATE_CONFIG = {
  HIGH_SCHOOL: {
    level: 'HIGH_SCHOOL',
    headerTitle: 'HIGH SCHOOL CLEARANCE CERTIFICATE',
    levelLabel: 'HIGH SCHOOL',
    signatories: createSignatories('HIGH_SCHOOL'),
  },
  UNDERGRADUATE: {
    level: 'UNDERGRADUATE',
    headerTitle: 'UNDERGRADUATE CLEARANCE CERTIFICATE',
    levelLabel: 'UNDERGRADUATE',
    signatories: createSignatories('UNDERGRADUATE'),
  },
  POSTGRADUATE: {
    level: 'POSTGRADUATE',
    headerTitle: 'POSTGRADUATE CLEARANCE CERTIFICATE',
    levelLabel: 'POSTGRADUATE',
    signatories: createSignatories('POSTGRADUATE'),
  },
};

export function getCertificateConfig(level) {
  return CERTIFICATE_CONFIG[String(level || '').toUpperCase()] || CERTIFICATE_CONFIG.UNDERGRADUATE;
}
