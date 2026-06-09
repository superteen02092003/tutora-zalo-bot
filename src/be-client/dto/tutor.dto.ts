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
  averageRating: number;
  totalReviews: number;
  completedHours: number;
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
  locationDistrict: string;
  budgetMax: number;
  genderPreference?: string;
}

export interface MatchTutorsResult {
  subjectId: number;
  candidates: TutorCandidateDto[];
}
