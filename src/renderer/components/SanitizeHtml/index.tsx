import { sanitize } from 'dompurify';

interface Props {
  html: string;
  classes: string;
}
export default function SanitizeHtml({ html, classes }: Props) {
  const trustedHtml = sanitize(html);
  return (
    <div
      className={classes}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: trustedHtml }}
    />
  );
}
