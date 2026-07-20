export type ArticleStatus =
  | "draft"
  | "outlined"
  | "generated"
  | "edited"
  | "checked"
  | "pushed"
  | "failed";

export type OutlineSection = {
  heading: string;
  summary: string;
};

export type OutlineOption = {
  index: number;
  title: string;
  positioning: string;
  sections: OutlineSection[];
};

export type ArticleFormValues = {
  topic: string;
  keywords?: string;
  style?: string;
  wordCount?: number;
  audience?: string;
  goal?: string;
};

export type ArticleDetail = {
  id: string;
  topic: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  outline: OutlineOption[] | null;
  selectedOutlineIndex: number | null;
  status: ArticleStatus;
  style: string | null;
  audience: string | null;
  goal: string | null;
  wordCount: number | null;
  coverImageUrl: string | null;
  wechatDraftId: string | null;
};

export type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};
