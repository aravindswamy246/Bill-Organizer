import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CategoryChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function CategoryChip({ label, selected, onPress }: CategoryChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? '#208AEF' : theme.backgroundElement }]}
    >
      <ThemedText type="smallBold" style={selected ? styles.selectedLabel : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
  selectedLabel: {
    color: '#ffffff',
  },
});
