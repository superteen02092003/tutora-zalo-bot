export type UserRole = 'parent' | 'tutor' | 'student' | 'admin';

export interface UserDto {
  userId: string;
  zaloUserId: string;
  fullName: string;
  primaryRole: UserRole;
  status: number;
}

export interface UpsertZaloLeadResponse extends UserDto {
  isNew: boolean;
}
