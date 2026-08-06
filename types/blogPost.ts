export interface BlogPost {
  id: number;
  slug: string;
  link: string;
  title: string;
  excerpt: string;
  date: string;
  image?: {
    src: string;
    alt: string;
  };
  author: {
    name: string;
    avatarUrl?: string;
  };
  categories: string[];
}
