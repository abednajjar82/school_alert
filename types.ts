
export interface SchoolClass {
  id: string;
  name: string;
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  days: string[];    // Array of days (e.g., ["الأحد", "الاثنين"])
  active: boolean;
}

export interface AlarmState {
  isActive: boolean;
  className: string;
  type: 'start' | 'end';
}
