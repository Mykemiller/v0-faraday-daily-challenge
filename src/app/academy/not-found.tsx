// Faraday Academy — the 404 body.
//
// Reached by notFound() from any academy route. Rendering this from a page body
// with a 200 status, as the course routes used to, is a soft 404: crawlers index
// it as a real page and monitoring cannot tell a miss from a hit. The status code
// is the contract; this is only what the reader sees.

import { CourseNotFound } from "@/components/academy/states";

export default function AcademyNotFound() {
  return <CourseNotFound />;
}
