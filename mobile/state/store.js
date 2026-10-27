import { useState } from 'react';

export function useAppState() {
  const [data, setData] = useState(null);
  const [chats, setChats] = useState({});
  return { data, setData, chats, setChats };
}
