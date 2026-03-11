interface Props {
  content: string;
  maxHeight?: string;
  className?: string;
}

export default function CommandOutput({ content, maxHeight = '400px', className = '' }: Props) {
  const lines = content.split('\n');
  return (
    <pre className={`terminal-output ${className}`} style={{ maxHeight }}>
      {lines.map((line, i) => {
        let color = '';
        if (line.includes('[OK]') || line.includes('PASSED') || line.includes('success') || line.startsWith('●') && line.includes('active (running)')) color = 'text-success';
        else if (line.includes('[ERROR]') || line.includes('FAIL') || line.includes('error')) color = 'text-destructive';
        else if (line.includes('[WARN]') || line.includes('warning')) color = 'text-warning';
        else if (line.startsWith('===') || line.startsWith('Result:')) color = 'text-accent font-bold';

        return <div key={i} className={color}>{line || '\u00A0'}</div>;
      })}
    </pre>
  );
}
