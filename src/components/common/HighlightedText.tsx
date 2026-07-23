/**
 * HighlightedText — renders text with one or more substrings highlighted using a distinct style.
 *
 * Usage: <HighlightedText text={message} highlight="Not Riding" highlightStyle={styles.highlight} />
 */

import React from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';

interface HighlightedTextProps {
  /** Full text to render. */
  text: string;
  /** Substring, or list of substrings, to highlight wherever they occur in `text`. */
  highlight: string | string[];
  /** Style applied to the surrounding (non-highlighted) text. */
  style?: StyleProp<TextStyle>;
  /** Style applied to the highlighted substrings. */
  highlightStyle?: StyleProp<TextStyle>;
  /** Whether matching is case-sensitive. Defaults to false. */
  caseSensitive?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  highlight,
  style,
  highlightStyle,
  caseSensitive = false,
}) => {
  const phrases = (Array.isArray(highlight) ? highlight : [highlight]).filter((phrase) => phrase.length > 0);

  if (phrases.length === 0) {
    return <Text style={style}>{text}</Text>;
  }

  const pattern = phrases.map(escapeRegExp).join('|');
  const regex = new RegExp(`(${pattern})`, caseSensitive ? 'g' : 'gi');
  const segments = text.split(regex).filter((segment) => segment.length > 0);

  return (
    <Text style={style}>
      {segments.map((segment, index) => {
        const isMatch = phrases.some((phrase) =>
          caseSensitive ? segment === phrase : segment.toLowerCase() === phrase.toLowerCase(),
        );
        return (
          <Text key={index} style={isMatch ? highlightStyle : undefined}>
            {segment}
          </Text>
        );
      })}
    </Text>
  );
};
