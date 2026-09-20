export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";
export type Theme = "light" | "dark" | "system";
export type ModerationStatus = "APPROVED" | "REVIEW" | "HIDDEN";
export type ReactionKind = "Amen" | "Thoughtful" | "Encouraging" | "Helpful";
export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatar: string | null;
  role: "USER" | "MODERATOR";
  createdAt: string;
  defaultVisibility: Visibility;
  defaultComments: boolean;
  defaultReactions: boolean;
  theme: Theme;
  notifyFriends: boolean;
  notifyComments: boolean;
  notifyReactions: boolean;
}
export type PublicProfile = Pick<
  User,
  "id" | "username" | "displayName" | "bio" | "avatar" | "createdAt"
>;
export interface Reflection {
  id: string;
  authorId: string;
  author: PublicProfile;
  title: string;
  body: string;
  reference: string;
  bookId: string;
  target: Record<string, string | number | null | undefined>;
  visibility: Visibility;
  commentsEnabled: boolean;
  reactionsEnabled: boolean;
  moderationStatus: ModerationStatus;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  commentCount: number;
  reactions: Record<ReactionKind, number>;
  myReaction: ReactionKind | null;
}
export interface Comment {
  id: string;
  reflectionId: string;
  authorId: string;
  author: PublicProfile;
  body: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}
export interface Notification {
  id: string;
  kind: string;
  message: string;
  href: string;
  read: boolean;
  createdAt: string;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}
export interface RelationshipUser extends PublicProfile {
  relationship: "FRIEND" | "INCOMING" | "OUTGOING" | "NONE" | "BLOCKED";
}
export interface FriendsResult {
  friends: RelationshipUser[];
  incoming: RelationshipUser[];
  outgoing: RelationshipUser[];
  blocked: RelationshipUser[];
}
