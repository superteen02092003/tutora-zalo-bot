export type TutorSubscriptionType = 'standard' | 'pro' | 'premium';

export interface TutorCandidateDto {
  tutorId: string;
  fullName: string;
  avatarUrl?: string;
  gender?: 'male' | 'female';
  bio?: string;
  experience?: string;
  education?: string;
  subjects?: string[];
  grades?: string[];
  hourlyRate: number;
  trialLessonPrice?: number;
  price_min?: number;
  price_max?: number;
  averageRating: number;
  totalReviews: number;
  totalCompletedLessons: number;
  totalStudentsTaught: number;
  subscriptionType: TutorSubscriptionType;
  teachingMode: 'online' | 'offline' | 'both';
  teachingAreaCity?: string;
  teachingAreaDistrict?: string;
  requiredSessionsPerWeek?: number;
  requiredSessionDurationHours?: number;
  requiredTotalSessions?: number;
}

export interface MatchCriteria {
  subject: string;
  grade: string;
  teachingMode: 'online' | 'offline' | 'both';
  locationDistrict?: string;
  purpose?: 'exam_prep' | 'regular' | 'foundation' | 'advanced';
  genderPreference?: 'male' | 'female' | 'any';
}

export interface MatchTutorsResult {
  subjectId: number;
  candidates: TutorCandidateDto[];
}
