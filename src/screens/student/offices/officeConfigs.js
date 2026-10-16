import {
  BookOpen,
  FileCheck2,
  GraduationCap,
  HeartPulse,
  Landmark,
  ShieldCheck,
  UsersRound,
} from 'lucide-react-native';

// The database stores one live clearance item and its proof history per office.
// Keep student-specific status and review notes out of static screen config.
export const OFFICE_SCREEN_CONFIG = {
  REGISTRAR: {
    code: 'REGISTRAR', title: 'Registrar Office', icon: FileCheck2,
    subtitle: 'Submit records requested by the Registrar and track your clearance decision.',
    uploadTitle: 'Registrar proof', uploadLabel: 'UPLOAD REGISTRAR PROOF',
  },
  DEAN: {
    code: 'DEAN', title: 'Department Dean', icon: GraduationCap,
    subtitle: 'Submit documents requested by your department and track the Dean’s clearance decision.',
    uploadTitle: 'Department proof', uploadLabel: 'UPLOAD DEPARTMENT PROOF',
  },
  DIRECTOR_SAS: {
    code: 'DIRECTOR_SAS', title: 'Director / SAS', icon: ShieldCheck,
    subtitle: 'Submit documents requested by Student Affairs and Services and track your clearance decision.',
    uploadTitle: 'Student Affairs proof', uploadLabel: 'UPLOAD STUDENT AFFAIRS PROOF',
  },
  GUIDANCE: {
    code: 'GUIDANCE', title: 'Guidance Counselor', icon: HeartPulse,
    subtitle: 'Submit requested Guidance documents and complete the exit survey for your clearance.',
    uploadTitle: 'Guidance proof', uploadLabel: 'UPLOAD GUIDANCE PROOF',
    sections: [{ title: 'EXIT SURVEY', type: 'action', text: 'Share one goal you want to focus on after completing this school year.', actionLabel: 'START EXIT SURVEY' }],
  },
  ADVISER: {
    code: 'ADVISER', title: 'Organization Adviser', icon: UsersRound,
    subtitle: 'Submit documents requested by your assigned organization adviser and track your clearance decision.',
    uploadTitle: 'Organization proof', uploadLabel: 'UPLOAD ORGANIZATION PROOF',
  },
  PROPERTY: {
    code: 'PROPERTY', title: 'Property Custodian', icon: Landmark,
    subtitle: 'Submit proof requested by the Property Custodian and track your clearance decision.',
    uploadTitle: 'Property proof', uploadLabel: 'UPLOAD PROPERTY PROOF',
  },
  LIBRARIAN: {
    code: 'LIBRARIAN', title: 'Librarian', icon: BookOpen,
    subtitle: 'Submit documents requested by the Library and track your clearance decision.',
    uploadTitle: 'Library proof', uploadLabel: 'UPLOAD LIBRARY PROOF',
  },
  COUNCIL: {
    code: 'COUNCIL', title: 'Student Council', icon: UsersRound,
    subtitle: 'Submit documents requested by the Student Council and track your clearance decision.',
    uploadTitle: 'Student Council proof', uploadLabel: 'UPLOAD COUNCIL PROOF',
  },
  CLINIC: {
    code: 'CLINIC', title: 'School Clinic', icon: HeartPulse,
    subtitle: 'Submit documents requested by the School Clinic and track your clearance decision.',
    uploadTitle: 'Clinic proof', uploadLabel: 'UPLOAD CLINIC PROOF',
  },
};
