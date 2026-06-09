export interface TutorAvailabilitySlot {
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1=Thứ 2, 7=Chủ nhật
  startHour: number;
  endHour: number;
}

export interface TutorAvailabilityDto {
  tutorId: string;
  tutorName: string;
  slots: TutorAvailabilitySlot[];
}
