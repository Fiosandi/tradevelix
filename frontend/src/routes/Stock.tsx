import React from 'react';
import { useParams } from 'react-router-dom';

export const Stock: React.FC = () => {
  const { ticker } = useParams();
  return <div className="text-sub text-sm">Stock detail for <span className="text-text font-semibold">{ticker}</span> — coming next.</div>;
};
