export type AuthenticatedUser = {
  email: string;
  name: string;
  picture?: string | null;
  sub: string;
};

export type AppProfile = {
  userId: number;
  displayName: string;
  email: string;
  age: number;
  gender: string;
  licenceNo: string | null;
  authProvider: string | null;
  authSubject: string | null;
  pictureUrl: string | null;
  createdAt: string;
};

export type ProfileSessionResponse = {
  needsProfileCompletion: boolean;
  profile: AppProfile | null;
  missingFields?: string[];
  suggestedDisplayName?: string;
};

export type ProfileSessionPayload = {
  authProvider: string;
  authSubject: string;
  email: string;
  displayName?: string;
  pictureUrl?: string | null;
  age?: number | null;
  gender?: string | null;
  licenceNo?: string | null;
};

export type UpdateProfilePayload = {
  userId: number;
  displayName?: string;
  age?: number;
  gender?: string;
  licenceNo?: string | null;
};
