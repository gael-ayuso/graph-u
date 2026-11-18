import { recommendationFeedback } from "@/lib/app-queries";
export { setRecommendationFeedback as PUT } from "@/lib/recommendation-actions";

export const GET = recommendationFeedback;
