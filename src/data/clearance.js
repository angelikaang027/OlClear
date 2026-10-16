import { OFFICES } from '../constants/offices.js';

export const DEPARTMENTS = ['CICTE', 'CONAHS', 'COAB', 'COED', 'STAHM', 'SOLG', 'HS'];

export const CLEARANCE_OFFICES = OFFICES.map((office) => office.name);

export const LEVELS = ['HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE'];
export const CLEARANCE_TYPES = ['REGULAR_SEMESTER', 'GRADUATING', 'TRANSFER_EXIT'];

export const initialClearance = CLEARANCE_OFFICES.map((office, index) => ({
  office,
  status: index < 2 ? 'APPROVED' : index === 2 ? 'SUBMITTED' : index === 3 ? 'HOLD' : 'PENDING',
  remark: index === 3 ? 'Please return the borrowed laboratory key.' : '',
  departmentSpecific: office === 'Department Dean' || office === 'Organization Adviser',
}));
