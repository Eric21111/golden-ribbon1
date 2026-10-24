import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { managerColors } from './theme';

interface SearchInputProps
  extends Pick<TextInputProps, 'value' | 'onChangeText' | 'placeholder' | 'autoCapitalize' | 'returnKeyType' | 'onSubmitEditing'> {}

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search',
  autoCapitalize = 'none',
  returnKeyType,
  onSubmitEditing,
}: SearchInputProps) {
  return (
    <View style={styles.container}>
      <Ionicons name="search-outline" size={18} color={managerColors.subtext} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={managerColors.subtext}
        autoCapitalize={autoCapitalize}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
  },
  input: {
    flex: 1,
    color: managerColors.ink,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
});
